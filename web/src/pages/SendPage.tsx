import React, { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'

export function SendPage() {
	const [code, setCode] = useState<string>('')
	const [qrDataUrl, setQrDataUrl] = useState<string>('')
	const wsRef = useRef<WebSocket | null>(null)
	const pcRef = useRef<RTCPeerConnection | null>(null)
	const dcRef = useRef<RTCDataChannel | null>(null)
	const [status, setStatus] = useState<string>('Hazırlanıyor...')

	useEffect(() => {
		async function init() {
			// create code
			const res = await fetch('/api/code', { method: 'POST' })
			const data = await res.json()
			setCode(data.code)
			const url = `${location.origin}/receive/${data.code}`
			setQrDataUrl(await QRCode.toDataURL(url))

			// setup ws
			const ws = new WebSocket(WS_URL)
			wsRef.current = ws
			ws.addEventListener('open', () => {
				ws.send(JSON.stringify({ type: 'join', code: data.code, role: 'sender' }))
				setStatus('Oda hazır, alıcı bekleniyor...')
			})
			ws.addEventListener('message', async (event) => {
				const msg = JSON.parse(event.data)
				if (msg.type === 'peer-joined' && msg.role === 'receiver') {
					await createAndSendOffer()
				}
				if (msg.type === 'signal' && msg.payload?.type === 'answer') {
					await pcRef.current?.setRemoteDescription(msg.payload)
					setStatus('Bağlantı kuruldu. Dosya seçebilirsiniz.')
				}
				if (msg.type === 'signal' && msg.payload?.candidate) {
					try { await pcRef.current?.addIceCandidate(msg.payload) } catch {}
				}
			})

			// create RTCPeerConnection
			const iceServers = [
				{ urls: 'stun:stun.l.google.com:19302' },
			]
			if (import.meta.env.VITE_TURN_URL && import.meta.env.VITE_TURN_USER && import.meta.env.VITE_TURN_PASS) {
				iceServers.push({
					urls: import.meta.env.VITE_TURN_URL as string,
					username: import.meta.env.VITE_TURN_USER as string,
					credential: import.meta.env.VITE_TURN_PASS as string,
				} as any)
			}
			const pc = new RTCPeerConnection({ iceServers })
			pcRef.current = pc
			pc.onicecandidate = (e) => {
				if (e.candidate) {
					ws.send(JSON.stringify({ type: 'signal', code: data.code, payload: e.candidate }))
				}
			}
			const dc = pc.createDataChannel('file')
			dcRef.current = dc
			dc.onopen = () => setStatus('DataChannel hazır')
			dc.onclose = () => setStatus('Bağlantı kapandı')
			dc.onerror = () => setStatus('DataChannel hatası')
			dc.bufferedAmountLowThreshold = 512 * 1024
		}
		init()
		return () => {
			wsRef.current?.close()
			pcRef.current?.close()
		}
	}, [])

	async function createAndSendOffer() {
		if (!pcRef.current || !wsRef.current || !code) return
		const offer = await pcRef.current.createOffer()
		await pcRef.current.setLocalDescription(offer)
		wsRef.current.send(JSON.stringify({ type: 'signal', code, payload: offer }))
	}

	const [file, setFile] = useState<File | null>(null)
	const [progress, setProgress] = useState<number>(0)
	const [speedKbps, setSpeedKbps] = useState<number>(0)
	const [etaSec, setEtaSec] = useState<number>(0)
	const [sending, setSending] = useState<boolean>(false)

	function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
		const f = e.target.files?.[0] || null
		setFile(f)
	}

	function waitForBuffer(dc: RTCDataChannel) {
		if (dc.bufferedAmount < (dc.bufferedAmountLowThreshold || 0)) return Promise.resolve()
		return new Promise<void>((resolve) => {
			const handler = () => {
				if (dc.bufferedAmount < (dc.bufferedAmountLowThreshold || 0)) {
					dc.removeEventListener('bufferedamountlow', handler)
					resolve()
				}
			}
			dc.addEventListener('bufferedamountlow', handler)
		})
	}

	async function sendFile() {
		if (!file || !dcRef.current) return
		const dc = dcRef.current
		const chunkSize = 64 * 1024
		let offset = 0
		setProgress(0)
		setSpeedKbps(0)
		setEtaSec(0)
		setSending(true)
		const start = performance.now()
		const meta = { name: file.name, size: file.size, mimeType: file.type }
		dc.send(JSON.stringify({ type: 'meta', ...meta }))
		while (offset < file.size && sending) {
			const slice = file.slice(offset, offset + chunkSize)
			const arrayBuffer = await slice.arrayBuffer()
			dc.send(arrayBuffer)
			offset += slice.size
			const elapsedSec = (performance.now() - start) / 1000
			const speed = offset / 1024 / (elapsedSec || 1)
			setSpeedKbps(speed)
			setProgress(Math.round((offset / file.size) * 100))
			setEtaSec(Math.max(0, Math.round((file.size - offset) / (speed * 1024 + 1))))
			await waitForBuffer(dc)
		}
		dc.send(JSON.stringify({ type: 'eof' }))
		setSending(false)
	}

	function cancelSend() {
		setSending(false)
		dcRef.current?.close()
		pcRef.current?.close()
		setStatus('Gönderim iptal edildi')
	}

	return (
		<div style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
			<h1>Gönder</h1>
			{code && (
				<div>
					<p>Kod: <b>{code}</b></p>
					{qrDataUrl && <img src={qrDataUrl} alt="QR" style={{ width: 200, height: 200 }} />}
				</div>
			)}
			<p>{status}</p>
			<hr />
			<input type="file" onChange={handleFileSelect} />
			<div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
				<button onClick={sendFile} disabled={!file || sending}>Gönder</button>
				<button onClick={cancelSend} disabled={!sending}>İptal</button>
			</div>
			{file && (
				<div>
					<p>İlerleme: {progress}%</p>
					{sending && <p>Hız: {speedKbps.toFixed(0)} KB/s · ETA: {etaSec}s</p>}
				</div>
			)}
		</div>
	)
}