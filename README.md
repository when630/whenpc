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

GPU 사용률은 작업 관리자와 같은 방식으로 계산한다. 엔진별로 프로세스 사용률을 합산한 뒤 가장 바쁜 엔진의 값을 쓴다.

## 온도

Windows는 드라이버 없이 CPU 코어 온도를 제공하지 않는다. 그래서 기본으로는 ACPI 열 영역 값을 표시하는데, 이 값은 보통 메인보드 주변 온도에 가깝다.

실제 CPU/GPU 온도를 보려면 다음과 같이 한다.
1. [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)를 관리자 권한으로 실행한다.
2. `Options > Remote Web Server > Run`을 켠다(기본 포트 8085).
3. 위젯이 자동으로 감지해서 `CPU xx°C · GPU xx°C`로 바꿔 표시한다.

## 개발용

`WHENPC_SNAPSHOT=out.png npm start`로 실행하면 8초 뒤 위젯 화면을 PNG로 저장하고 종료한다. 대기 시간은 `WHENPC_SNAPSHOT_DELAY`(ms)로 조정한다.
