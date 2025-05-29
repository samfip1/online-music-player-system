import { SessionProvider } from "next-auth/react";
import Appbar from "./Componets/Appbar";
import { Providers } from "./Providers";

export default function Home() {

  console.log(process.env.GOOGLE_CLIENT_ID);
  console.log(process.env.GOOGLE_CLIENT_SECRET);
  return (
    <div>
      <h1>Hello</h1>
      <Providers>
      <Appbar />
      </Providers>
      
    </div>
  )
}
