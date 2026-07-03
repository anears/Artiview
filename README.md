# Artiview

에이전트가 생성한 HTML 결과물·발표자료와 Markdown 문서를 모아 보고 관리하는
데스크톱 앱입니다. 크롬으로는 번거로운
**최근 본 파일 / 전문(내용) 검색 / 썸네일 / 즐겨찾기·태그**를
한 곳에서 제공합니다. (Tauri 2 + React + Rust)

## 기능

- **폴더 자동 인덱싱** — 결과물이 쌓이는 폴더를 등록하면 하위 `.html`/`.htm`과
  `.md`/`.markdown`을 재귀로 스캔합니다. `새로고침`을 누르면 변경분만 다시 인덱싱하고
  삭제된 파일은 정리합니다.
- **Markdown 렌더링** — `.md`는 GitHub 스타일 + 코드 구문 하이라이트로 렌더해서
  HTML과 동일하게 카드·뷰어에서 봅니다. 문서 내 상대경로 이미지도 해당 폴더 기준으로 표시됩니다.
- **개별 파일 열기** — 등록 폴더 밖의 파일도 `파일 열기`로 바로 보고, 자동으로 최근 목록에 기록됩니다.
- **원격 폴더 (SSH/SFTP)** — 사이드바의 🌐 버튼으로 서버 폴더(`user@host:/path` 또는
  `~/.ssh/config` 별칭)를 등록하면 로컬 폴더처럼 스캔·검색·썸네일·뷰어가 동작합니다.
  인증은 ssh-agent·기본 키·`.pem` 키 파일·비밀번호를 지원합니다.
- **전문 검색** — 파일명뿐 아니라 HTML 본문 텍스트까지 SQLite FTS5로 색인해 검색합니다.
- **문서 내 검색** — 뷰어에서 `⌘/Ctrl+F`로 현재 문서(HTML·Markdown) 안의 텍스트를 찾아
  하이라이트하고, `Enter`/`Shift+Enter`로 일치 항목을 오가며 개수를 표시합니다.
- **썸네일 미리보기** — 각 HTML을 실제로 축소 렌더한 미리보기 카드(스크린샷이 아니라 항상 정확).
- **최근 / 즐겨찾기 / 태그** — 사이드바에서 빠르게 필터링.
- **제목·메타 자동 추출** — `<title>` → 첫 헤딩 → 파일명 순으로 표시 이름을 결정.
- **내장 뷰어 + 브라우저로 열기** — 앱 안에서 바로 보거나 기본 브라우저로 엽니다.

## 개발 실행

```bash
npm install
npm run tauri dev
```

## 배포용 빌드 (.app / .dmg)

```bash
npm run tauri build
```

## 데이터 저장 위치

라이브러리 인덱스(등록 폴더, 색인, 최근, 즐겨찾기, 태그)는 macOS 앱 데이터 디렉터리의
`library.db`(SQLite)에 저장됩니다. 원본 HTML 파일은 절대 수정·삭제하지 않습니다.

## 구조

```
src-tauri/         Rust 백엔드
  src/db.rs        SQLite 스키마 + FTS5 + 쿼리
  src/html.rs      <title>/헤딩/본문 텍스트 추출 (의존성 없는 스캐너)
  src/remote.rs    SSH/SFTP 연결 풀 + remote:// 프로토콜 서버
  src/lib.rs       폴더 스캔 + Tauri 커맨드
src/               React 프론트엔드
  api.ts           invoke 래퍼
  markdown.ts      markdown-it + highlight.js 렌더 + iframe 소스 훅
  components/       Sidebar · Toolbar · FileGrid · FileCard · Viewer · TagEditor
```

## 비고

- 파일 접근 범위는 `tauri.conf.json`의 `assetProtocol.scope`로 제한됩니다
  (기본: 홈 디렉터리 및 `/Volumes`). 다른 위치의 파일을 보려면 scope를 넓히세요.
- 썸네일은 카드가 화면에 들어올 때만 lazy 렌더됩니다.

### 원격 폴더 보안 메모

- **SSH 비밀번호는 디스크에 저장되지 않습니다.** 앱 실행 중 메모리에만 유지되고,
  재시작하면 다시 물어봅니다 (macOS Keychain 연동은 future work).
- 서버 host key는 아직 `known_hosts`와 대조하지 않습니다 (future work) —
  신뢰할 수 있는 내부망에서 사용하세요.
- 원격 파일 읽기는 50MB로 제한되며, 스캔은 디렉터리 깊이 16 / 항목 2만 개에서
  안전 상한에 걸리면 삭제 판정을 건너뜁니다 (오탐 삭제 방지).
