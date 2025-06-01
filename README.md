# 🗒️ Just Sticky Notes

실시간 스티키 노트 커뮤니티 사이트입니다. 나무 배경의 무한 캔버스에 스티키 노트를 붙이며 다른 사용자들과 실시간으로 소통할 수 있습니다.

## ✨ 특징

- 🌳 **나무 배경 무한 캔버스**: 제한 없는 공간에서 자유롭게 노트 작성
- 🎨 **손글씨 스타일**: Caveat 폰트와 그리기 기능으로 자연스러운 느낌
- ⚡ **실시간 동기화**: WebSocket을 통한 실시간 노트 공유
- 🔐 **구글 로그인**: 간편한 OAuth 인증
- 🎯 **직관적인 도구**: 이동 도구와 노트 생성 도구
- 🎨 **다양한 색상**: 6가지 스티키 노트 색상 선택
- ✏️ **그리기 기능**: 펜, 밑줄, 동그라미 등 그리기 도구
- 📱 **반응형 디자인**: 모바일과 데스크톱 지원

## 🛠️ 기술 스택

- **Frontend**: Vanilla JavaScript, CSS3, HTML5
- **Backend**: Cloudflare Workers
- **Storage**: Cloudflare R2
- **Real-time**: WebSocket API
- **Deployment**: Cloudflare Pages + Workers

## 🚀 빠른 시작

### 1. 프로젝트 클론 및 설정

```bash
git clone <repository-url>
cd just-sticky-notes
npm install
```

### 2. Cloudflare 계정 설정

1. [Cloudflare 대시보드](https://dash.cloudflare.com)에 로그인
2. Workers & Pages 섹션으로 이동
3. API 토큰 생성 (권한: Zone:Read, Account:Edit)

### 3. Wrangler 로그인

```bash
npx wrangler login
```

### 4. R2 버킷 생성

**생성할 버킷 이름:**
- `just-sticky-notes-storage` (메인 버킷)
- `just-sticky-notes-storage-preview` (미리보기 버킷)

```bash
# 자동으로 버킷 생성 및 정적 파일 업로드
npm run setup
```

또는 수동으로:

```bash
# 버킷 생성
npm run create-bucket
npm run create-preview-bucket

# 정적 파일 업로드
npm run upload-static
```

### 5. 개발 서버 실행

```bash
npm run dev
```

### 6. 배포

```bash
# 스테이징 환경
npm run deploy:staging

# 프로덕션 환경  
npm run deploy:production
```

## 📁 프로젝트 구조

```
just-sticky-notes/
├── index.html          # 메인 HTML 파일
├── styles.css          # 스타일시트
├── app.js              # 클라이언트 JavaScript
├── _worker.js          # Cloudflare Worker (백엔드)
├── wrangler.toml       # Cloudflare 설정
├── package.json        # 프로젝트 설정
└── README.md           # 프로젝트 문서
```

## 🎮 사용법

### 로그인
1. 페이지에 접속하면 나무 배경에 구글 아이콘이 있는 스티키 노트가 표시됩니다
2. 스티키 노트를 클릭하면 떨어지는 애니메이션과 함께 구글 로그인이 진행됩니다

### 도구 사용법
- **이동 도구** (기본): 캔버스를 드래그하여 이동, 마우스 휠로 줌 인/아웃
- **노트 생성 도구**: 캔버스를 클릭하여 새 스티키 노트 작성

### 노트 작성
1. 노트 생성 도구 선택 후 캔버스 클릭
2. 모달에서 색상 선택 (6가지 색상)
3. 텍스트 입력 (최대 500자)
4. 그리기 도구로 그림 추가 (펜, 밑줄, 동그라미)
5. 저장 버튼으로 노트 게시

### 키보드 단축키
- `Space`: 도구 전환 (이동 ↔ 노트 생성)
- `Escape`: 노트 에디터 닫기
- `Ctrl + +/-`: 줌 인/아웃

## 🔧 환경 변수

`wrangler.toml`에서 설정:

```toml
[vars]
ENVIRONMENT = "production"
MAX_NOTES_PER_USER = "50"      # 사용자당 최대 노트 수
MAX_TOTAL_NOTES = "1000"       # 전체 최대 노트 수
```

## 📊 API 엔드포인트

### REST API
- `GET /api/notes` - 모든 노트 조회
- `GET /api/health` - 서버 상태 확인

### WebSocket
- `ws://your-domain.com/ws` - 실시간 연결
- 메시지 타입: `auth`, `create_note`, `load_notes`, `ping`

## 🗄️ 데이터 구조

### 스티키 노트
```javascript
{
  id: "note_timestamp_randomid",
  text: "노트 내용",
  drawing: "data:image/png;base64,그리기데이터",
  color: "#FFEB3B",
  x: 100,
  y: 200,
  author: "사용자명",
  authorId: "user_id",
  timestamp: 1640995200000,
  rotation: -2.5
}
```

## 🔒 보안

- CORS 헤더 설정으로 크로스 오리진 요청 제어
- WebSocket 인증 메커니즘
- 노트 수 제한으로 스팸 방지
- 자동 클라이언트 정리로 메모리 관리

## 🚨 문제 해결

### 일반적인 문제

1. **WebSocket 연결 실패**
   - 브라우저가 WebSocket을 지원하는지 확인
   - HTTPS 환경에서는 WSS 프로토콜 사용 필요

2. **노트가 저장되지 않음**
   - R2 버킷 권한 확인
   - Worker 로그 확인: `npm run tail`

3. **스타일이 적용되지 않음**
   - 정적 파일이 R2에 업로드되었는지 확인
   - 캐시 클리어 후 재시도

### 디버깅

```bash
# Worker 로그 실시간 확인
npm run tail

# 로컬 개발 환경
npm run dev
```

## 📈 성능 최적화

- 스티키 노트 최대 1000개 제한
- 30분 이상 비활성 클라이언트 자동 정리
- R2 캐시 헤더 설정 (1시간)
- 이미지 최적화 (Canvas toDataURL)

## 🤝 기여하기

1. 이슈 생성
2. 기능 브랜치 생성
3. 커밋 및 푸시
4. Pull Request 생성

## 📄 라이선스

MIT License

## 🔗 관련 링크

- [Cloudflare Workers 문서](https://developers.cloudflare.com/workers/)
- [Cloudflare R2 문서](https://developers.cloudflare.com/r2/)
- [WebSocket API 문서](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

---

⭐ 이 프로젝트가 도움이 되셨다면 스타를 눌러주세요! 