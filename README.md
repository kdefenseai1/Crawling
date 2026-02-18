# 이미지 선택 다운로드 앱

이미지를 검색하고, 원하는 결과를 선택해서 ZIP으로 다운로드하는 앱입니다.

## 1) 로컬 실행 (웹)

```bash
npm install
npm run start
```

브라우저에서 `http://localhost:3001` 접속

## 2) macOS 앱 실행 (개발용)

```bash
npm run desktop
```

Electron 창으로 앱이 실행됩니다.

## 3) macOS 배포 파일 빌드 (.dmg / .zip)

```bash
npm run dist:mac
```

생성 위치:
- `dist/*.dmg`
- `dist/*-mac.zip`

## 4) 환경 설정

기본은 DuckDuckGo 검색입니다.

```env
SEARCH_PROVIDER=duckduckgo
PORT=3001
```

Google 검색을 쓰고 싶다면:

```env
SEARCH_PROVIDER=google
GOOGLE_API_KEY=발급받은_API_KEY
GOOGLE_CSE_ID=발급받은_CX
PORT=3001
```
