"use client"
import { SessionProvider } from "next-auth/react";
import React from "react";


//`useSession` must be wrapped in a <SessionProvider />
export function Providers({ children }:
    {children: React.ReactNode}
) {
    return (
        <SessionProvider>
            {children}
        </SessionProvider>
    )
}