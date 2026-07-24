const major = Number(process.versions.node.split('.')[0])

if (major >= 24) {
  console.error('')
  console.error('❌ Node.js', process.version, '에서는 better-sqlite3가 동작하지 않을 수 있습니다.')
  console.error('   Node.js 22 LTS를 설치한 뒤 다시 실행하세요: https://nodejs.org/')
  console.error('   설치 후: node -v  →  v22.x.x 인지 확인')
  console.error('')
  process.exit(1)
}
