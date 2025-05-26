from fastapi import FastAPI, HTTPException
import threading
from pydantic import BaseModel, HttpUrl
from typing import List
import traceback
import uuid
import torch
import numpy as np
import matplotlib.pyplot as plt
import tempfile
import requests
from monai.transforms import (
    Compose, LoadImage, EnsureChannelFirst, Spacing, Orientation,
    ScaleIntensityRange, EnsureType
)
from monai.inferers import sliding_window_inference
from monai.networks.nets import SwinUNETR
from google.cloud import storage

BEST_MODEL_PATH = "model_v2.pth"
GCP_CREDENTIALS_PATH = "gcp_credentials.json"

processing_lock = threading.Lock()

def process_ct_to_gcs(image_url: str, gcs_bucket: str, gcs_prefix="ct-overlays") -> dict:
    # Download image to temp file
    with tempfile.NamedTemporaryFile(suffix=".nii.gz", delete=False) as temp_file:
        r = requests.get(image_url)
        r.raise_for_status()
        temp_file.write(r.content)
        local_image_path = temp_file.name

    # MONAI Preprocessing
    transforms = Compose([
        LoadImage(image_only=True),
        EnsureChannelFirst(),
        Spacing(pixdim=(1.5, 1.5, 2.0), mode="bilinear"),
        Orientation(axcodes="RAS"),
        ScaleIntensityRange(a_min=-57, a_max=164, b_min=0.0, b_max=1.0, clip=True),
        EnsureType(),
    ])
    image = transforms(local_image_path)
    image_np = image[0].cpu().numpy()
    input_tensor = image.unsqueeze(0).to("cuda" if torch.cuda.is_available() else "cpu")

    # Load Model
    model = SwinUNETR(
        img_size=(96, 96, 96),
        in_channels=1,
        out_channels=7,
        feature_size=48,
        drop_rate=0.1,
        attn_drop_rate=0.1,
        dropout_path_rate=0.1,
        use_checkpoint=True,
    ).to(input_tensor.device)
    model.load_state_dict(torch.load(BEST_MODEL_PATH, map_location=input_tensor.device))
    model.eval()

    # Run inference
    with torch.no_grad():
        output = sliding_window_inference(input_tensor, (96, 96, 64), sw_batch_size=1, predictor=model)
        prediction = torch.argmax(output, dim=1).cpu().numpy()[0]

    label_1_mask = (prediction == 1).astype(np.uint8)

    # Prepare overlays
    def overlay_slice(img_slice, mask_slice):
        norm = (img_slice - img_slice.min()) / (img_slice.ptp() + 1e-8)
        rgb = np.stack([norm]*3, axis=-1)
        rgb[mask_slice == 1] = [1, 0, 0]
        return rgb

    planes = {
        "axial": {"axis": 2, "slicer": lambda img, i: img[:, :, i]},
        "coronal": {"axis": 1, "slicer": lambda img, i: img[:, i, :]},
        "sagittal": {"axis": 0, "slicer": lambda img, i: img[i, :, :]},
    }

    result = {}
    # Change GCP credentials file
    storage_client = storage.Client.from_service_account_json(GCP_CREDENTIALS_PATH)
    bucket = storage_client.bucket(gcs_bucket)

    for plane_name, info in planes.items():
        axis = info["axis"]
        slicer = info["slicer"]
        shape = label_1_mask.shape
        areas = [(i, np.sum(slicer(label_1_mask, i))) for i in range(shape[axis])]
        top_slices = sorted([a for a in areas if a[1] > 0], key=lambda x: -x[1])[:3]

        urls = []
        for idx, area in top_slices:
            img_slice = slicer(image_np, idx)
            mask_slice = slicer(label_1_mask, idx)
            overlay = overlay_slice(img_slice, mask_slice)

            # Save overlay to temp file
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as img_file:
                plt.imsave(img_file.name, overlay)
                local_path = img_file.name

            # Upload to GCS
            uid = str(uuid.uuid4())
            blob_name = f"{gcs_prefix}/{plane_name}/{uid}.png"
            blob = bucket.blob(blob_name)
            blob.upload_from_filename(local_path)
            blob.upload_from_filename(local_path)
            urls.append(f"https://storage.googleapis.com/{gcs_bucket}/{blob_name}")

        result[plane_name] = urls

    return result

app = FastAPI()

# Request model
class SegmentRequest(BaseModel):
    image_url: HttpUrl

# Response model
class SegmentResponse(BaseModel):
    axial: List[str]
    coronal: List[str]
    sagittal: List[str]

# Endpoint
@app.post("/segment", response_model=SegmentResponse)
def segment(request: SegmentRequest):
    # Try to acquire the lock without blocking
    if not processing_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Busy")

    try:
        result = process_ct_to_gcs(
            image_url=request.image_url,
            gcs_bucket="tomographies"
        )
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        processing_lock.release()

