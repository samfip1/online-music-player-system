import { NextResponse } from "next/server";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import NextAuth from "next-auth"


// export function GET() {
//     return NextResponse.json({
//         message: "Hii there"
//     })
// }





const handler = NextAuth({
  providers: [
    GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? ""
  }),
  GitHubProvider({
    clientId: process.env.GITHUB_CIENT_ID ?? "",
    clientSecret: process.env.GITHUB_CIENT_SECRET ?? ""
  })
  ]
})

export { handler as GET, handler as POST }