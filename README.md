# whenpc

바탕화면에 띄워 두는 시스템 사용량 위젯 (Electron, Windows 10/11).

CPU · 메모리 · GPU(엔진별) · GPU 메모리 · 디스크 I/O·드라이브 용량 · 네트워크 · 온도를 1초마다 표시한다.

## 실행

```sh
npm install
npm start
```

- 위젯 아무 곳이나 끌어서 이동한다. 위치는 저장된다.
- 헤더의 네모 창 아이콘을 누르면 상세 패널이 펼쳐진다. CPU·메모리·GPU·디스크 I/O별로 사용량이 많은 프로세스 10개를 같은 이름끼리 합산해 보여 준다. 프로세스별 수집은 패널이 열려 있을 때만 돈다.
- 톱니바퀴(마우스를 올리면 보임), 트레이 아이콘 더블클릭, 트레이 메뉴의 "설정…" 중 하나로 설정 창을 연다. 표시 항목, 배경 투명도, 크기, 그래프, 항상 위, 위치 고정, 시작 시 실행을 고를 수 있다.
- "위치 고정"을 켜면 위젯이 클릭을 받지 않는다. 해제는 트레이 메뉴에서 한다.

## 구조

| 파일 | 역할 |
|---|---|
| `collector/collector.ps1` | PowerShell 안에 C#(PDH API)을 컴파일해 성능 카운터를 읽고, 매초 JSON 한 줄을 stdout으로 출력한다. 영문 카운터 이름(`PdhAddEnglishCounter`)을 쓰므로 한국어 Windows에서도 동작한다. |
| `src/main.js` | 창·트레이·설정을 관리하고, 수집기 프로세스를 띄워 결과를 렌더러로 전달한다. 수집기가 죽으면 다시 띄운다. |
| `src/lhm.js` | (선택) LibreHardwareMonitor에서 온도를 읽는다. |
| `src/renderer/` | 위젯(`index.html`)과 설정 창(`settings.html`) UI. 스파크라인은 canvas로 그린다. |
| `src/updater.js` | GitHub Releases 자동 업데이트(electron-updater). |
| `src/watchdog.js` | 위젯 렌더러 감시. CPU가 1분 넘게 80% 이상이거나 메모리가 1.5GB를 넘으면 CPU 프로파일과 직전 이벤트 기록을 `%APPDATA%\whenpc\diagnostics`에 남기고 렌더러를 새 프로세스로 다시 띄운다. 트레이의 "진단 기록 폴더 열기"로 연다. |
| `src/deck.js` | 스트림덱 플러그인용 로컬 통로(`127.0.0.1:37631`). 사용량과 위젯 상태를 SSE로 보내고, 위젯 숨기기/보이기를 받는다. |
| `integrations/ulanzi/` | Ulanzi 덱(D200 등) 플러그인. 앱 빌드에는 들어가지 않는다. |

GPU 사용률은 작업 관리자와 같은 방식으로 계산한다. 엔진별로 프로세스 사용률을 합산한 뒤 가장 바쁜 엔진의 값을 쓴다.

## 스킨과 테마

스킨은 FOG 하나다. when* 시리즈 브랜드 "안개 + 라임"으로, whencode(`src/renderer/src/styles/tokens.css`)·whendesk(`renderer/themes.css`)와 같은 색을 쓴다. 테마는 FOG(밝게)와 FOG DARK(어둡게) 둘이고, 설정 창에서 둘 중 하나나 SYSTEM(기본, Windows 앱 모드를 따라 바뀜)을 고른다. 위젯, 상세 패널, 설정 창, 덱 키에 모두 적용된다.

- 바탕은 안개색, 타일·설정 묶음은 한 단 밝은 카드색. 둥글기는 버튼·줄 6px, 타일 10px, 카드 14px.
- 라임은 고른 것·누를 것(스위치, 고른 탭, 펼침 버튼, 주 버튼)에만 쓴다. 밝은 테마에서 라임을 선으로 그어야 할 때(고른 칸 테두리, 포커스)는 진한 올리브(`--accent-ink`)를 쓴다.
- 빨강은 넘친 것(사용률 과부하, 온도, 닫기)에만 쓴다.
- 색은 `src/renderer/themes.css`, 테마 목록은 `src/themes.json`, 색을 화면 역할에 잇는 것과 모양은 `src/renderer/ui.css`.
- 0.2.10 이전 설정의 whenterminal 스킨·테마는 SYSTEM으로 바뀐다.
- 글꼴은 Pretendard(설치 파일에 포함), 고정폭은 Cascadia Code(Windows 기본).

## 아이콘

FOG 색(먹색·안개색에 라임 하나, 둥근 정사각형 타일)으로, whencode 앱 아이콘(`>_`)과 같은 계열이다. GAUGE만 밝은 안개색 타일이고 라임 대신 진한 올리브를 쓴다(밝은 면에서 라임은 흐리다). 원본은 `build/icons/*.svg`이고 기본은 `bars`다. 설정 창의 "앱 아이콘"에서 BARS · GAUGE · PC_ 중에 고르면 트레이와 창 아이콘이 바로 바뀐다. 설치 파일과 바로가기 아이콘은 빌드 때 정해지므로 BARS로 고정이다.

```sh
npx electron scripts/render-icons.cjs   # SVG → PNG, 미리보기 build/icons/preview.png, src/assets/icons/*.png와 build/icon.png 갱신
```

## 온도

Windows는 드라이버 없이 CPU 코어 온도를 제공하지 않는다. 그래서 기본으로는 ACPI 열 영역 값을 표시하는데, 이 값은 보통 메인보드 주변 온도에 가깝다.

실제 CPU/GPU 온도를 보려면 다음과 같이 한다.
1. [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)를 관리자 권한으로 실행한다.
2. `Options > Remote Web Server > Run`을 켠다(기본 포트 8085).
3. 위젯이 자동으로 감지해서 `CPU xx°C · GPU xx°C`로 바꿔 표시한다.

## 스트림덱 (Ulanzi)

Ulanzi 덱 키에 사용량을 보여 주고, 키를 눌러 위젯을 숨기거나 다시 띄울 수 있다. 설치와 액션은 [integrations/ulanzi/README.md](integrations/ulanzi/README.md)를 본다.

## 개발용

`WHENPC_SNAPSHOT=out.png npm start`로 실행하면 8초 뒤 위젯 화면을 PNG로 저장하고 종료한다. 대기 시간은 `WHENPC_SNAPSHOT_DELAY`(ms)로 조정한다.

`WHENPC_WATCHDOG_SAMPLE_MS=2000`을 주면 렌더러 감시 주기가 15초에서 2초로 줄어 감시 동작을 빨리 확인할 수 있다. `.cpuprofile`은 Chrome DevTools의 Performance 패널에 끌어다 놓으면 열린다.

## 배포와 자동 업데이트

설치판(NSIS)은 [GitHub Releases](https://github.com/when630/whenpc/releases)로 배포한다. 설치된 앱은 electron-updater로 시작 10초 후와 이후 4시간마다 새 릴리스를 확인한다. 새 버전은 백그라운드에서 받아 두고 알림을 띄운다. 알림을 누르거나 설정 창 또는 트레이의 "업데이트 설치"를 누르면 바로 재시작해 설치하고, 그냥 두면 다음 종료 때 설치된다. 개발 모드(`npm start`)에서는 업데이트가 꺼져 있다.

새 버전 배포:

```sh
npm version patch          # package.json 버전을 올리고 vX.Y.Z 태그를 만든다
git push --follow-tags     # 태그 push → GitHub Actions(.github/workflows/release.yml)가 빌드해 릴리스에 올린다
```

로컬 빌드만: `npm run dist` → `dist/whenpc-Setup-<버전>.exe`

설치 파일은 코드 서명이 없어서 처음 실행할 때 SmartScreen 경고가 뜰 수 있다("추가 정보 → 실행").

