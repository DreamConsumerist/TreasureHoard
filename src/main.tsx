import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import './index.css'
import Home from './routes/Home.tsx'
import Login from './routes/Login.tsx'

// Caches API responses and tracks loading/error state for every query.
const queryClient = new QueryClient()

// Client-side routes. Netlify serves index.html for every path (the SPA
// fallback in netlify.toml), then this router picks the page.
const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/login', element: <Login /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
