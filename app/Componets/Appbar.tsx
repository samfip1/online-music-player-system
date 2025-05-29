"use client"
import { SessionProvider, signIn, signOut, useSession } from 'next-auth/react'
import React from 'react'

function Appbar() {

    
    const session = useSession();
  return (
    <div className="flex justify-between items-center p-4 bg-lime-500 rounded-lg shadow-md">
      <div className="text-xl font-bold text-white">
        Music System
      </div>
      <div>
        {session.data?.user && <button onClick={() => signOut()} className="bg-white text-lime-600 font-semibold px-4 py-2 rounded hover:bg-lime-100 transition">Sign Out</button>}
        {!session.data?.user && <button onClick={() => signIn()} className="bg-white text-lime-600 font-semibold px-4 py-2 rounded hover:bg-lime-100 transition">Sign In</button>}
      </div>
    </div>
  )
}

export default Appbar
