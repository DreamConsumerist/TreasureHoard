import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import './index.css'
import { AppShell } from './components/AppShell.tsx'
import { UpdateBar } from './components/UpdateBar.tsx'
import AccountRegister from './routes/AccountRegister.tsx'
import AccountsPage from './routes/AccountsPage.tsx'
import Collection from './routes/Collection.tsx'
import CollectionNew from './routes/CollectionNew.tsx'
import Dashboard from './routes/Dashboard.tsx'
import DecklistImport from './routes/DecklistImport.tsx'
import GroupPage from './routes/GroupPage.tsx'
import ItemPage from './routes/ItemPage.tsx'
import Login from './routes/Login.tsx'
import Recurring from './routes/Recurring.tsx'
import RecurringEdit from './routes/RecurringEdit.tsx'
import Register from './routes/Register.tsx'
import Settings from './routes/Settings.tsx'
import TransactionPage from './routes/TransactionPage.tsx'

// Caches API responses and tracks loading/error state for every query.
const queryClient = new QueryClient()

// Client-side routes. In production Netlify serves index.html for every path
// (the SPA fallback written by vite.config.ts), then this router picks the page.
// Every logged-in page renders inside AppShell (sidebar / tab bar / quick-add).
const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/ledger', element: <Register /> },
      { path: '/ledger/new', element: <TransactionPage /> },
      { path: '/ledger/accounts', element: <AccountsPage /> },
      { path: '/ledger/accounts/:id', element: <AccountRegister /> },
      { path: '/ledger/recurring', element: <Recurring /> },
      { path: '/ledger/recurring/new', element: <RecurringEdit /> },
      { path: '/ledger/recurring/:id', element: <RecurringEdit /> },
      { path: '/ledger/:id', element: <TransactionPage /> },
      { path: '/collection', element: <Collection /> },
      { path: '/collection/new', element: <CollectionNew /> },
      { path: '/collection/groups/:id', element: <GroupPage /> },
      { path: '/collection/import', element: <DecklistImport /> },
      { path: '/collection/:id', element: <ItemPage /> },
      { path: '/settings', element: <Settings /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <UpdateBar />
    </QueryClientProvider>
  </StrictMode>,
)
