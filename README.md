# Just Sticky Notes 📝

실시간 스티키 노트 커뮤니티 사이트입니다. 나무 배경의 무한 캔버스에서 다른 사용자들과 함께 스티키 노트를 공유할 수 있습니다.

## ✨ 주요 기능

### 🎨 **사용자 경험**
- **나무 텍스처 배경**: 따뜻한 나무 배경의 무한 캔버스
- **구글 로그인**: 떨어지는 애니메이션이 있는 스티키 노트로 로그인
- **handwriting 폰트**: 손글씨 느낌의 Caveat, Kalam 폰트 사용
- **6가지 스티키 노트 색상**: 노란색, 주황색, 분홍색, 보라색, 파란색, 초록색

### 🛠️ **도구 및 기능**
- **이동 도구**: 캔버스 팬/줌 (마우스 휠, 드래그)
- **스티키 노트 생성**: 텍스트 + 그리기가 통합된 캔버스
- **그리기 도구**: 펜, 밑줄, 동그라미, 지우기
- **실시간 드래그**: 내가 만든 노트를 드래그해서 이동 가능
- **키보드 단축키**: `M` (이동), `N` (노트 생성), `+/-` (줌)

### 🌐 **실시간 기능**
- **WebSocket 실시간 통신**: 즉시 동기화
- **사용자 입장/퇴장 알림**: 실시간 참여자 확인
- **자동 재연결**: 30초 heartbeat + 페이지 포커스 시 재동기화
- **연결 상태 표시**: 상태바에 연결 상태 표시

## 🏗️ 기술 스택

### **Frontend**
- **Vanilla JavaScript**: 프레임워크 없는 순수 JS
- **CSS3**: 애니메이션, Grid/Flexbox, 반응형 디자인
- **HTML5 Canvas**: 그리기 기능
- **Google Fonts**: Caveat, Kalam 손글씨 폰트

### **Backend** 
- **Cloudflare Pages**: 정적 파일 호스팅
- **Cloudflare Functions**: 서버리스 API
- **WebSocket API**: 실시간 통신
- **R2 Object Storage**: 스티키 노트 데이터 저장

### **배포 및 인프라**
- **Cloudflare Pages**: 자동 배포 및 CDN
- **R2 Bucket**: `STICKY_NOTES_BUCKET` 환경 변수로 설정
- **무료 티어**: Cloudflare 무료 계정으로 운영 가능

## 🚀 배포하기

### 1. **저장소 준비**
```bash
git clone <your-repo>
cd just-sticky-notes
```

### 2. **Cloudflare Pages 배포**
1. [Cloudflare 대시보드](https://dash.cloudflare.com)에서 Pages 선택
2. "Create a project" → "Connect to Git" 
3. 저장소 선택 후 다음 설정:
   - **Production branch**: `main`
   - **Build command**: `npm run build`
   - **Build output directory**: `/` (루트)
   - **Root directory**: `/` (루트)

### 3. **R2 Bucket 설정**
1. Cloudflare 대시보드에서 R2 → "Create bucket"
2. Bucket 이름: `just-sticky-notes-storage` (또는 원하는 이름)
3. Pages 프로젝트 → Settings → Functions → "R2 bucket bindings"
4. 바인딩 추가:
   - **Variable name**: `STICKY_NOTES_BUCKET`
   - **R2 bucket**: 위에서 생성한 bucket 선택

### 4. **배포 확인**
- `https://your-project-name.pages.dev`에서 사이트 확인
- `/api/health`에서 API 상태 확인
- `/api/debug`에서 R2 연결 상태 확인

## 📁 프로젝트 구조

```
just-sticky-notes/
├── index.html              # 메인 HTML 파일
├── styles.css              # 스타일시트
├── app.js                  # 클라이언트 JavaScript
├── favicon.ico             # 파비콘
├── _routes                 # Pages Functions 라우팅 설정
├── functions/              # Cloudflare Functions
│   ├── ws.js              # WebSocket 처리 (/ws)
│   └── api/               # API 엔드포인트들
│       ├── notes.js       # 노트 API (/api/notes)
│       ├── health.js      # 헬스체크 (/api/health)
│       └── debug.js       # 디버그 정보 (/api/debug)
├── package.json           # 프로젝트 설정
├── README.md             # 이 파일
└── .gitignore            # Git 제외 파일들
```

## 🔧 API 엔드포인트

### **REST API**
- `GET /api/notes`: 모든 스티키 노트 조회
- `GET /api/health`: 서버 상태 확인
- `GET /api/debug`: 디버그 정보 (R2 연결 상태 등)

### **WebSocket** (`/ws`)
```javascript
// 연결
const ws = new WebSocket('wss://your-site.pages.dev/ws');

// 메시지 타입들
{
  type: 'auth',           // 사용자 인증
  type: 'load_notes',     // 노트 로드 요청
  type: 'create_note',    // 새 노트 생성
  type: 'update_note',    // 노트 위치 업데이트  
  type: 'delete_note',    // 노트 삭제
  type: 'sync_request',   // 동기화 요청
  type: 'ping'            // 연결 상태 확인
}
```

## 🎮 사용법

### **기본 조작**
1. **로그인**: 구글 스티키 노트 클릭 (데모 모드)
2. **이동**: `M` 키 또는 이동 도구 선택 후 캔버스 드래그
3. **줌**: 마우스 휠 또는 `+`/`-` 키
4. **노트 생성**: `N` 키 또는 노트 도구 선택 후 캔버스 클릭

### **노트 편집**
1. **색상 선택**: 6가지 색상 중 선택
2. **텍스트 입력**: 투명 텍스트 영역에 글 작성
3. **그리기**: 펜/밑줄/동그라미 도구로 그리기
4. **저장**: "붙이기" 버튼으로 캔버스에 추가

### **실시간 협업**
- **다른 사용자 노트**: 실시간으로 나타남
- **내 노트 이동**: 드래그해서 위치 변경 가능 (다른 사용자에게도 실시간 반영)
- **자동 동기화**: 페이지 포커스 시 자동으로 최신 상태 동기화

## ⚡ 성능 최적화

- **requestAnimationFrame**: 부드러운 드래그 애니메이션
- **WebSocket 연결 관리**: 자동 재연결 + heartbeat
- **데이터 제한**: 최대 1000개 노트, 500자 제한
- **클라이언트 정리**: 30분 비활성 클라이언트 자동 정리

## 🔒 보안

- **CORS 설정**: 적절한 CORS 헤더
- **입력 검증**: 텍스트 길이 및 형식 검증
- **에러 처리**: 포괄적인 에러 핸들링

## 📈 모니터링

- **헬스체크**: `/api/health`로 서버 상태 확인
- **디버그 정보**: `/api/debug`로 상세 정보 확인
- **실시간 로그**: Cloudflare 대시보드에서 함수 로그 확인

## 🤝 기여하기

1. 저장소 Fork
2. 기능 브랜치 생성 (`git checkout -b feature/AmazingFeature`)
3. 변경사항 커밋 (`git commit -m 'Add some AmazingFeature'`)
4. 브랜치에 Push (`git push origin feature/AmazingFeature`)
5. Pull Request 생성

## 📄 라이선스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

---

### 🎯 **Just Sticky Notes** - *함께 만드는 디지털 메모장* 📝✨ 