# Just Sticky Notes

실시간으로 스티키 노트를 통해 소통하는 커뮤니티 사이트입니다. 나무 배경의 무한 캔버스에서 다른 사용자들과 함께 스티키 노트를 붙이고 편집할 수 있습니다.

## 🌟 주요 기능

- **무한 캔버스**: 제한 없는 나무 배경에서 자유롭게 이동하고 줌 인/아웃
- **실시간 협업**: WebSocket을 통한 실시간 스티키 노트 동기화
- **구글 OAuth 로그인**: 간편한 구글 계정 로그인
- **스티키 노트 편집**: 색상 변경, 텍스트 편집, 꾸미기 도구
- **손글씨 폰트**: 자연스러운 손글씨 느낌의 Kalam 폰트
- **모바일 지원**: 터치 제스처를 통한 모바일 친화적 인터페이스

## 🛠 기술 스택

- **Frontend**: Vanilla JavaScript, HTML5 Canvas, CSS3
- **Backend**: Cloudflare Workers + Durable Objects
- **실시간 통신**: WebSocket
- **스토리지**: Cloudflare R2 Bucket
- **인증**: Google OAuth 2.0
- **배포**: Cloudflare Pages

## 📋 사전 요구사항

1. Cloudflare 계정
2. Google Cloud Console 프로젝트 (OAuth 설정용)
3. Node.js 및 npm

## 🚀 설정 가이드

### 1. 프로젝트 설치

```bash
npm install
```

### 2. Google OAuth 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 새 프로젝트 생성
2. "APIs & Services" > "Credentials"로 이동
3. "Create Credentials" > "OAuth 2.0 Client IDs" 선택
4. Application type: "Web application"
5. Authorized redirect URIs 추가:
   - `http://localhost:3000/api/auth/callback` (개발용)
   - `https://your-domain.pages.dev/api/auth/callback` (배포용)

### 3. Cloudflare R2 버킷 생성

다음 이름의 R2 버킷을 생성해야 합니다:
```
just-sticky-notes-data
```

### 4. 환경 변수 설정

`wrangler.toml` 파일에서 다음 변수들을 설정하세요:

```toml
[vars]
GOOGLE_CLIENT_ID = "your-google-client-id"
GOOGLE_CLIENT_SECRET = "your-google-client-secret"
```

또는 Cloudflare 대시보드에서 환경 변수로 설정할 수 있습니다.

### 5. 개발 서버 실행

```bash
npm run dev
```

### 6. 빌드 및 배포

```bash
npm run build
npm run deploy
```

## 🎮 사용법

### 로그인
1. 메인 페이지의 구글 로그인 스티키 노트를 클릭
2. 구글 계정으로 로그인

### 도구 사용
- **이동 도구**: 캔버스를 드래그하여 이동, 마우스 휠로 줌 인/아웃
- **노트 생성 도구**: 캔버스를 클릭하여 새 스티키 노트 생성

### 스티키 노트 편집
1. 스티키 노트를 더블클릭하여 편집 모달 열기
2. 텍스트 입력 및 색상 변경
3. 저장 또는 삭제

### 키보드 단축키
- `1`: 이동 도구 선택
- `2`: 노트 생성 도구 선택
- `Esc`: 모달 닫기

## 🏗 프로젝트 구조

```
├── src/
│   ├── index.html          # 메인 HTML 파일
│   ├── index.js            # 클라이언트 JavaScript
│   └── styles.css          # 스타일시트
├── functions/
│   └── _worker.js          # Cloudflare Workers 백엔드
├── package.json
├── webpack.config.js
├── wrangler.toml           # Cloudflare 설정
└── README.md
```

## 🔧 API 엔드포인트

- `GET /api/auth/check` - 인증 상태 확인
- `GET /api/auth/google` - 구글 OAuth 로그인
- `GET /api/auth/callback` - OAuth 콜백
- `POST /api/auth/logout` - 로그아웃
- `WebSocket /api/ws` - 실시간 통신
- `POST /api/notes` - 스티키 노트 생성
- `PUT /api/notes` - 스티키 노트 수정
- `DELETE /api/notes/:id` - 스티키 노트 삭제

## 🌐 WebSocket 메시지 형식

### 클라이언트 → 서버
```json
{
  "type": "get_notes",
  "area": {
    "x": 0,
    "y": 0,
    "width": 1920,
    "height": 1080
  }
}
```

### 서버 → 클라이언트
```json
{
  "type": "notes_list",
  "notes": [...]
}

{
  "type": "note_created",
  "note": {...}
}

{
  "type": "note_updated",
  "note": {...}
}

{
  "type": "note_deleted",
  "noteId": "note_123"
}
```

## 🎨 커스터마이징

### 스티키 노트 색상 추가
`src/index.js`의 색상 배열에 새로운 색상을 추가할 수 있습니다.

### 나무 배경 변경
`src/styles.css`의 `.wood-background` 클래스를 수정하여 배경을 변경할 수 있습니다.

## 🤝 기여하기

1. 이 저장소를 포크하세요
2. 새 기능 브랜치를 만드세요 (`git checkout -b feature/amazing-feature`)
3. 변경사항을 커밋하세요 (`git commit -m 'Add some amazing feature'`)
4. 브랜치에 푸시하세요 (`git push origin feature/amazing-feature`)
5. Pull Request를 열어주세요

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 있습니다.

## 🐛 문제 해결

### WebSocket 연결 실패
- Cloudflare Workers에서 Durable Objects가 활성화되어 있는지 확인
- 올바른 WebSocket URL을 사용하고 있는지 확인

### OAuth 로그인 실패
- Google OAuth 설정에서 리디렉션 URI가 올바른지 확인
- 환경 변수가 올바르게 설정되어 있는지 확인

### R2 버킷 접근 실패
- 버킷 이름이 `wrangler.toml`과 일치하는지 확인
- Cloudflare 계정에 R2 권한이 있는지 확인

## 📞 지원

문제가 있거나 질문이 있으시면 GitHub Issues를 통해 문의해주세요. 