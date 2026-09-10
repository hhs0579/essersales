# 골든 숫자 체크리스트 (G1–G8)

> 재설계·배포 후 **동일 기간·동일 필터**에서 Before와 숫자가 같아야 한다.  
> 기간을 채운 뒤 화면/엑셀 스냅샷을 `docs/golden/snapshots/`에 보관한다 (대용량은 gitignore 가능).

관련: [rewrite-optimization-guide.md](../rewrite-optimization-guide.md)

---

## 공통

| 항목 | 값 |
|------|-----|
| 검증 기간 From | `____-__-__` |
| 검증 기간 To | `____-__-__` |
| NAS URL | `http://192.168.0.245:8080` |
| 검증일 | |
| 검증자 | |

### 프로덕션 플래그 (실측 = `.env.production.example`)

| Flag | 기대값 |
|------|--------|
| `VITE_KPI_SOURCE` | `server` |
| `VITE_SERVER_KPI_ONLY` | `true` |
| `VITE_LAZY_DETAIL_LOAD` | `true` |
| `VITE_EXPORT_API_MODE` | `pg` |
| `VITE_WRITE_API_MODE` | `pg` |

---

## 체크리스트

| ID | 탭 / 산출물 | Before (매출·마진·광고·원가 등) | After | Pass |
|----|-------------|----------------------------------|-------|------|
| G1 | 베스트하임 일별 | | | ☐ |
| G2 | 사본느리 일별 (+자사몰) | | | ☐ |
| G3 | 파워프라이스 (수수료 7%) | | | ☐ |
| G4 | 쿠팡 1P → BH 로켓/쿠팡 합산 | | | ☐ |
| G5 | 기타 판매처 (판매처 행) | | | ☐ |
| G6 | **통합** 세그먼트 합 = 합계, 광고 이중계상 없음 | | | ☐ |
| G7 | 통합 엑셀 (코멘트 5칸·일자별 스타일) | | | ☐ |
| G8 | 통합코멘트 (폐쇄몰 칸 포함) | | | ☐ |

### G6 추가 확인 (R1)

- [ ] Network에 `GET /api/v1/kpi/by-segment` 호출
- [ ] 통합 진입 시 detail records 19p prefetch **없음**
- [ ] 세그먼트 표 행 합계 = 합계 행 (원 단위 반올림 허용)

---

## 기능 동결

R1(서버 by-segment) 완료·골든 통과 전까지 **신규 비즈니스 기능(새 탭·새 KPI 칸) 추가 금지**. 버그픽스·숫자 회귀만 허용.
