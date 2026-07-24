import { execSync } from 'child_process'

const port = String(process.env.PORT || 3001)

if (process.platform === 'win32') {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
    const pids = new Set()
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && /^\d+$/.test(pid)) pids.add(pid)
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
        console.log(`포트 ${port} 사용 프로세스 종료 (PID ${pid})`)
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no listener */
  }
} else {
  try {
    execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'ignore', shell: true })
  } catch {
    /* no listener */
  }
}
