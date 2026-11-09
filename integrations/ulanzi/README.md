# whenpc · Ulanzi 덱 플러그인

Ulanzi Studio(D200 등) 키에 whenpc 사용량을 보여 주고, 눌러 위젯을 숨기거나 다시 띄운다. 앱의 로컬 통로 `127.0.0.1:37631`(`src/deck.js`)에서 SSE로 받는다.

## 설치

1. `com.ulanzi.whenpc.ulanziPlugin` 폴더를 `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`에 복사한다
2. Ulanzi Studio를 다시 켠다 → 액션 목록에 **whenpc** 분류가 생긴다

플러그인을 고친 뒤에는 다시 복사하고 Ulanzi Studio를 다시 켠다. whenpc는 v0.2.4 이상이어야 하고, 드라이브 용량·위치 고정·상위 프로세스·테마·가동 시간은 v0.2.8 이상이 필요하다.

## 액션

| 액션 | 보이는 것 | 누르면 |
|---|---|---|
| 위젯 | 위젯이 떠 있으면 SHOWN, 숨겨져 있으면 HIDDEN | 위젯을 숨기거나 다시 띄운다 (단축키 `Ctrl+Alt+W`와 같음) |
| 사용량 | 키 설정에서 고른 항목(CPU·메모리·GPU·디스크·네트워크·온도)의 지금 값과 최근 60초 추이. **요약**(CPU·메모리·GPU 막대 셋), **드라이브 용량**(드라이브 하나 또는 최대 3개)도 고를 수 있다 | 위젯을 숨기거나 다시 띄운다 |
| 위치 고정 | 클릭 통과가 켜져 있으면 LOCKED, 꺼져 있으면 FREE | 켜고 끈다 |
| 상위 프로세스 | CPU 또는 메모리(키 설정에서 기준 선택)를 가장 많이 쓰는 프로세스 3개(같은 이름은 합침) | 위젯 상세 패널을 그 탭으로 연다 |
| 테마 | 지금 테마를 그 색 그대로 미리보기 (키 설정에서 대상: 위젯 / 덱 키) | 같은 스킨의 다음 테마로 바꾼다 |
| 가동 시간 | PC를 켠 뒤 지난 시간과 부팅 시각 (7일 이상이면 강조색) | 위젯을 숨기거나 다시 띄운다 |

- 색과 글꼴 느낌은 whenpc 위젯의 스킨·테마를 따라간다. whenpc 설정 → 스트림덱 키에서 덱만 따로 고를 수 있다
- CPU·메모리·GPU는 90% 이상, 온도는 85° 이상이면 숫자가 강조색이 된다
- 상위 프로세스 키가 있는 동안만 whenpc가 프로세스별 사용량을 모은다(CPU를 조금 더 쓴다)
- 드라이브는 90% 이상 차면 강조색이 된다
- whenpc가 꺼져 있으면 `OFFLINE`

## 디버깅

Ulanzi Studio를 `--webRemoteDebug`로 켜고 `localhost:9292`에서 주 서비스(`plugin/app.html`) 콘솔을 본다. 통로는 `curl http://127.0.0.1:37631/state`로 확인한다.

`libs/`는 [UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK) 데모의 공용 라이브러리 사본이다(Apache-2.0, `libs/LICENSE-ulanzi-sdk`).
