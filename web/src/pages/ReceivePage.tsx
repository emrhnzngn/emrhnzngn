import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import QrScanner from 'qr-scanner'
import workerUrl from 'qr-scanner/qr-scanner-worker.min.js?url'

const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'

QrScanner.WORKER_PATH = workerUrl

export function ReceivePage() {
	const params = useParams()
	const [searchParams, setSearchParams] = useSearchParams()
	const [code, setCode] = useState<string>(params.code || searchParams.get('code') || '')
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const wsRef = useRef<WebSocket | null>(null)
	const pcRef = useRef<RTCPeerConnection | null>(null)
	const [status, setStatus] = useState<string>('Kod bekleniyor...')
	const [progress, setProgress] = useState<number>(0)
	const [speedKbps, setSpeedKbps] = useState<number>(0)
	const totalSizeRef = useRef<number>(0)
	const receivedRef = useRef<number>(0)
	const startRef = useRef<number>(0)

	useEffect(() => {
		if (!code) return
		const ws = new WebSocket(WS_URL)
		wsRef.current = ws
		ws.addEventListener('open', () => {
			ws.send(JSON.stringify({ type: 'join', code, role: 'receiver' }))
			setStatus('Gönderici bekleniyor...')
		})
		ws.addEventListener('message', async (event) => {
			const msg = JSON.parse(event.data)
			if (msg.type === 'signal' && msg.payload?.type === 'offer') {
				await ensurePc()
				await pcRef.current?.setRemoteDescription(msg.payload)
				const answer = await pcRef.current!.createAnswer()
				await pcRef.current!.setLocalDescription(answer)
				ws.send(JSON.stringify({ type: 'signal', code, payload: answer }))
				setStatus('Bağlantı kuruluyor...')
			}
			if (msg.type === 'signal' && msg.payload?.candidate) {
				try { await pcRef.current?.addIceCandidate(msg.payload) } catch {}
			}
		})
		return () => ws.close()
	}, [code])

	async function ensurePc() {
		if (pcRef.current) return
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
				wsRef.current?.send(JSON.stringify({ type: 'signal', code, payload: e.candidate }))
			}
		}
		pc.ondatachannel = (event) => {
			const dc = event.channel
			setStatus('DataChannel bağlandı')
			const chunks: Array<Uint8Array> = []
			let meta: { name: string; size: number; mimeType: string } | null = null
			dc.binaryType = 'arraybuffer'
			dc.onmessage = (e) => {
				if (typeof e.data === 'string') {
					try {
						const obj = JSON.parse(e.data)
						if (obj.type === 'meta') {
							meta = { name: obj.name, size: obj.size, mimeType: obj.mimeType }
							totalSizeRef.current = meta.size
							receivedRef.current = 0
							startRef.current = performance.now()
							setStatus(`Alınıyor: ${meta.name}`)
							return
						}
						if (obj.type === 'eof') {
							finalizeDownload(meta, chunks)
							return
						}
					} catch {}
					return
				}
				const buf = new Uint8Array(e.data as ArrayBuffer)
				receivedRef.current += buf.byteLength
				chunks.push(buf)
				if (totalSizeRef.current > 0) {
					setProgress(Math.round((receivedRef.current / totalSizeRef.current) * 100))
					const elapsedSec = (performance.now() - startRef.current) / 1000
					setSpeedKbps((receivedRef.current / 1024) / (elapsedSec || 1))
				}
			}
		}
	}

	function finalizeDownload(meta: { name: string; size: number; mimeType: string } | null, chunks: Uint8Array[]) {
		if (!meta) return
		const blob = new Blob(chunks, { type: meta.mimeType || 'application/octet-stream' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = meta.name
		a.click()
		URL.revokeObjectURL(url)
		setStatus('İndirme tamamlandı')
	}

	useEffect(() => {
		if (!videoRef.current) return
		const video = videoRef.current
		let qrScanner: QrScanner | null = null
		async function startScanner() {
			try {
				qrScanner = new QrScanner(video, (result) => {
					try {
						const text = String(result.data || result)
						const matched = text.match(/\/receive\/(\w+)/)
						if (matched?.[1]) {
							setCode(matched[1])
							setSearchParams({ code: matched[1] })
						}
					} catch {}
				}, { preferredCamera: 'environment' })
				await qrScanner.start()
			} catch (e) {
				console.warn('QR scanner error', e)
			}
		}
		startScanner()
		return () => {
			qrScanner?.stop()
			qrScanner?.destroy()
		}
	}, [])

	return (
		<div style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
			<h1>Al</h1>
			<div>
				<input placeholder="Kod" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
				<button onClick={() => setCode(code.trim().toUpperCase())}>Katıl</button>
			</div>
			<p>{status}</p>
			{progress > 0 && progress < 100 && (
				<p>İlerleme: {progress}% · Hız: {speedKbps.toFixed(0)} KB/s</p>
			)}
			<h3>QR ile Tara</h3>
			<video ref={videoRef} style={{ width: '100%', background: '#000' }} muted playsInline />
		</div>
	)
}