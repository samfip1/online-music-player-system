import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CreateStreamSchema = z.object({
    url: z.string().url().or(z.string().url().includes("youtube.com")).or(z.string().url().includes("spotify.com")),
    streamId: z.string()
})

export async function POST(req: NextRequest) {

    try{
        const body = CreateStreamSchema.parse(await req.json());
    }
    catch(e) {
        console.log("Error while parsing request body", e);
        return NextResponse.json({
            error: "Invalid request body"
        }, {
            status: 411
        })
    }
}