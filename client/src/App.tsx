import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router'
import { Backdrop, buttonClass, FullScreenMessage, PageLoader } from './components/ui'
import { Home } from './pages/Home'
import { Landing } from './pages/Landing'
import { SpacePage } from './pages/Space'

// Separate chunk: regular users never download the admin page.
const Admin = lazy(() => import('./pages/Admin'))
const Insights = lazy(() => import('./pages/Insights'))

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/home" element={<Home />} />
      <Route path="/space/:id" element={<SpacePage hostMode={false} />} />
      <Route path="/space/:id/host" element={<SpacePage hostMode />} />
      <Route
        path="/admin"
        element={
          <Suspense fallback={<PageLoader />}>
            <Admin />
          </Suspense>
        }
      />
      <Route
        path="/insights"
        element={
          <Suspense fallback={<PageLoader />}>
            <Insights />
          </Suspense>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function NotFound() {
  return (
    <>
      <Backdrop />
      <FullScreenMessage icon="music" title="Page not found">
        <Link to="/" className={`${buttonClass('secondary', 'md')} mt-6`}>
          Go home
        </Link>
      </FullScreenMessage>
    </>
  )
}
