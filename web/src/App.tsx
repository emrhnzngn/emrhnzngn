import { Link } from 'react-router-dom'

function App() {
  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>P2P Dosya Paylaşımı</h1>
      <p>Depolama yok. Kod ile bağlanın, QR ile hızla aktarın.</p>
      <div style={{ display: 'flex', gap: 12 }}>
        <Link to="/send">Gönder</Link>
        <Link to="/receive">Al</Link>
      </div>
    </div>
  )
}

export default App
