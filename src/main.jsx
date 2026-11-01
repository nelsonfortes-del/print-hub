import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PrintHub from './PrintHub.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrintHub />
  </StrictMode>,
)
