import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

const router = createBrowserRouter([
	{ path: '/', element: <App /> },
	{ path: '/send', lazy: () => import('./pages/SendPage.tsx').then(m => ({ Component: m.SendPage })) },
	{ path: '/receive', lazy: () => import('./pages/ReceivePage.tsx').then(m => ({ Component: m.ReceivePage })) },
	{ path: '/receive/:code', lazy: () => import('./pages/ReceivePage.tsx').then(m => ({ Component: m.ReceivePage })) },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<RouterProvider router={router} />
	</React.StrictMode>,
)
