import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetch(`${process.env.MODEL_API}/segment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    console.log(result);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json("Error while segmenting image");
  }
}
