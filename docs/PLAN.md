# Эко-щит Каспия — план MVP (Фаза 0)

> Статус: **на согласовании** · составлен 12.11.2026 · кейс 1 «Эко-щит Каспия», трек 1
> Документы — на русском; код, идентификаторы, комментарии и коммиты — на английском.
> Всё, что помечено «проверено», я проверил командами 12.11.2026 (вывод — в отчёте по Фазе 0).
> Всё, что помечено «допущение», нужно подтвердить или поправить.

## 0. Коротко

- **Что строим.** Веб-платформу «цифровой помощник инспектора ООПТ». В ней карта с живым статусом датчиков, лента тревог с полным жизненным циклом, ИИ-анализ звука (мотор лодки / выстрел), прогноз присутствия каспийского тюленя на 7 дней с зонами патрулирования и сценарный симулятор для демо. Всё запускается одной командой.
- **Территория:** федеральный заказник «Аграханский» (Дагестан). Граница взята из OpenStreetMap (`way/505346049`, проверено).
- **Прогноз:** каспийский тюлень, осенняя миграция — ровно в даты демо (§7).
- **Архитектура:** модульный монолит Next.js 16.4.6 + ML-сервис FastAPI + воркер `ingest` + PostgreSQL 18/PostGIS 3.7 + Mosquitto (MQTT/TLS) + Caddy (HTTPS в локальной сети для телефона).
- **Демо не зависит от Wi-Fi площадки.** Ноутбук раздаёт свою точку доступа (адаптер поддерживает режим AP — проверено). Тайлы, шрифты, модель и данные лежат локально. Внешние данные для прогноза кэшируются заранее.

## 1. Окружение (проверено 12.11.2026)

| Инструмент | Состояние | Что сделать |
|---|---|---|
| ОС / железо | Fedora 44, x86_64, 10 ядер, 30 ГБ ОЗУ, 289 ГБ свободно | — |
| git | 2.55.0, `user.name`/`user.email` заданы | — |
| Репозиторий | ветка `main` **без коммитов**, remote **не настроен**, дерево пустое | создать приватный репозиторий на GitHub, добавить remote |
| Docker | CLI 29.8.1, Compose v5.5.1, **демон остановлен, сервис отключён** | `sudo systemctl enable --now docker`, пользователя — в группу `docker` |
| Podman | 5.8.4 | запасной вариант |
| Node.js / npm / corepack | **не установлены** (в dnf есть `nodejs24` 24.18.0) | Node 24 LTS |
| pnpm | **нет** (в dnf 10.33, актуальная — 12.18.0) | pnpm 12.18.0 |
| Python | 3.14.7 (системный) | ML-сервис — Python 3.13 в Docker; локально `uv python install 3.13` |
| uv | **нет** | uv 0.13.7 |
| gh | **нет** | нужен для PR и настройки правил `main` |
| gitleaks, lefthook | нет | lefthook ставится через pnpm; gitleaks — бинарник или Docker-образ |
| openssl / jq | 3.5.8 / 1.8.1 | ок (локальный CA сгенерируем через openssl) |
| PlatformIO / arduino-cli | нет | нужен только для ESP32 (should-have) |
| Wi-Fi `wlp0s20f3` | режим AP: да; 2.4 и 5 ГГц | точка доступа для демо |

## 2. Версии ключевых пакетов (проверены в npm, PyPI, Docker Hub)

| Компонент | Версия | Примечание |
|---|---|---|
| next / eslint-config-next | **16.4.6** | Advisories для `>=16.0.0 <=16.4.0` подтверждены: GHSA-673q-mjm6-r5xr (RCE через `use cache`), GHSA-2464-fhr4-w9xw (RCE через SVG в Image Optimization), GHSA-p3m5-59mp-jv5r (DoS через Server Actions). 16.4.6 чистая. |
| sharp (транзитивно) | 0.35.5 | `<0.35.5` уязвим (GHSA-wq5f-xc86-pv6w, librsvg); next 16.4.6 требует `^0.35.5` |
| react / react-dom | 19.3.1 | |
| typescript | **6.0.3** (не 7.0.2) | typescript-eslint 8.72.2 из eslint-config-next требует `typescript >=4.8.4 <6.1.0` |
| Node.js | **24.22.3 LTS** | Node 26 — активный LTS, но 24 ставится из dnf, поддерживается до 04.2028 и указан в `engines` у vitest |
| pnpm | 12.18.0 | перед настройкой прочитать release notes 11/12 |
| better-auth | 1.7.22 | проверено по типам: `password.hash/verify`, `disableSignUp`, `rateLimit.storage: "database"`, `useSecureCookies`, `telemetry.enabled` (по умолчанию `false`) |
| drizzle-orm / drizzle-kit | 0.45.4 / 0.31.11 | стабильные (1.0 пока rc) |
| pg | 8.23.1 | |
| zod | 4.6.7 | |
| maplibre-gl | **6.18.0** | мажорная версия 6: API сверяем с документацией при установке |
| pmtiles / @protomaps/basemaps | 4.5.0 / 5.7.2 | go-pmtiles CLI v1.31.2 — для вырезки района |
| tailwindcss / shadcn (CLI) / radix-ui | 4.3.5 / 4.23.0 / 1.8.1 | |
| vitest / @playwright/test / lighthouse | 5.1.0 / 1.65.0 / 13.6.0 | |
| PostgreSQL / PostGIS | 18.6 / 3.7 (`postgis/postgis:18-3.7`) | образ **только amd64** (риск R7) |
| Mosquitto / Caddy | `eclipse-mosquitto:2.0.22` / `caddy:2.11.9-alpine` | |
| Python-стек ML | fastapi 0.162.5, uvicorn 0.54.0, pydantic 2.14.3, numpy 2.5.4, ai-edge-litert 2.3.0, soundfile 0.14.0, soxr 1.1.0, pillow 13.0.0, scikit-learn 1.9.1 | Python 3.13: у TF 2.21 нет колёс под 3.14; у LiteRT есть колёса aarch64 для RPi |

**Что изменилось в Next.js 16.x.** Всё ниже я прочитал во встроенной документации 16.4.6 (`node_modules/next/dist/docs`):

- `middleware.ts` → `proxy.ts`.
- `next lint` удалён, вместо него ESLint CLI.
- Анализатор бандлов для Turbopack: `next analyze` (с 16.1), `next analyze export` (с 16.4).
- Cache Components включается флагом `cacheComponents: true` вместе с `partialPrefetching: true`. В «рекомендуемых настройках» `create-next-app` 16.4 он включён — отсюда «по умолчанию для новых приложений».
- `export const instant = false` помечает сегмент, которому разрешено блокировать рендер.

## 3. Допущения

| # | Допущение | Если неверно |
|---|---|---|
| A1 | До демо ~48 ч, из них ~36 эффективных рабочих. Команда из 4 человек: веб, бэкенд/инфра, ML, железо + питч. Плюс ИИ-агенты в отдельных worktree. | Пересоберу треки в §18 |
| A2 | Демо-ноутбук — эта машина (Fedora, x86_64) | Проверить архитектуру: для ARM нужен другой образ PostGIS (R7) |
| A3 | Сеть на демо — точка доступа ноутбука (NetworkManager, обычно 10.42.0.1). Интернет нужен только до демо: сборка образов и кэш данных. | Площадочный Wi-Fi остаётся запасным вариантом |
| A4 | Телефон открывает веб по HTTPS через Caddy. Сертификат выпускает наш локальный CA, корневой сертификат заранее ставится на телефон. | Запасной вариант — мобильная вёрстка в окне 375 px на ноутбуке (R1) |
| A5 | Территория — заказник «Аграханский» плюс иллюстративная морская операционная зона вокруг Аграханского п-ова. Зоны режима — **демонстрационные**, юридический статус не утверждаем. | Поменять полигон сида |
| A6 | Прогноз — присутствие каспийского тюленя, не нерест рыб | §7 |
| A7 | «Акустический буй» — надводный буй с воздушным микрофоном: модели AudioSet обучены на воздушном звуке. Гидрофоны — вне рамок. | Нужны другие данные и модель |
| A8 | Персональных данных реальных людей нет. Демо-пользователи вымышленные. | — |
| A9 | Документация на русском | Переведём ARCHITECTURE/SECURITY/MODEL_CARD |

**Открытые вопросы** (продублированы в отчёте): состав команды и реальный бюджет часов; какие именно датчики и какая модель RPi есть; телефон на демо (iOS/Android) и можно ли поставить на него корневой сертификат; кто ставит инструменты (sudo); GitHub-репозиторий и `gh auth`.

## 4. Рамки

**Must.**
- Дашборд инспектора: карта со слоями, лента тревог, карточка тревоги, жизненный цикл.
- Аудио-ИИ: загрузка файла и поток от буя.
- Прогноз со слоем на карте и объяснением.
- Аутентификация с ролями на сервере.
- Симулятор сценариев.
- Запуск одной командой с сидом.

**Should.**
- ESP32 с датчиками воды по MQTT/TLS.
- RPi-буй с инференсом на краю.
- Английская локаль.
- PWA и индикатор устаревших данных.

**Could** — только после всего остального: спутниковый модуль (Sentinel-1/2), AR.

**Вне рамок:** платежи, чат, соцфункции, микросервис на каждую фичу, Kubernetes, Redis (обоснование в §5.4).

## 5. Архитектура

### 5.1 Схема

```mermaid
flowchart LR
  subgraph field["Поле · сеть точки доступа ноутбука"]
    esp["ESP32<br/>водная станция<br/>(should)"]
    rpi["Raspberry Pi<br/>акустический буй<br/>(should)"]
    phone["Телефон инспектора"]
    desk["Ноутбук диспетчера"]
  end
  subgraph stack["Docker Compose на одном ноутбуке"]
    caddy["Caddy 2.11<br/>HTTPS :443 · тайлы PMTiles"]
    web["apps/web · Next.js 16.4.6<br/>UI · Auth · DAL · Server Actions · SSE"]
    mq["Mosquitto 2.0.22<br/>MQTT/TLS :8883 · ACL"]
    sim["services/simulator<br/>сценарии демо"]
    ing["services/ingest · Node 24<br/>валидация · правила · очередь клипов · джоб прогноза"]
    ml["services/ml · FastAPI<br/>YAMNet на LiteRT · модель прогноза"]
    pg[("PostgreSQL 18 + PostGIS 3.7")]
    clips[["том clips<br/>вне web root"]]
  end
  ext["Open-Meteo · NOAA OISST<br/>загрузка до демо + кэш"]
  esp -- "MQTT/TLS" --> mq
  rpi -- "MQTT/TLS" --> mq
  sim -- "MQTT/TLS, те же контракты" --> mq
  mq --> ing
  ing -- "HTTP + сервисный токен" --> ml
  ing -- "SQL, роль ingest" --> pg
  ing --- clips
  web --- clips
  web -- "SQL, роль web, LISTEN/NOTIFY" --> pg
  web -- "health" --> ml
  web -- "admin: старт/сброс сценария" --> sim
  phone -- "HTTPS + SSE" --> caddy
  desk -- "HTTPS + SSE" --> caddy
  caddy --> web
  ing -. "HTTPS" .-> ext
```

### 5.2 Путь тревоги и бюджет задержки (цель ≤ 3 с, ожидание ~1 с — измерим)

```mermaid
sequenceDiagram
  participant B as Буй или симулятор
  participant Q as Mosquitto
  participant I as ingest
  participant A as ML (FastAPI)
  participant D as Postgres
  participant W as web
  participant U as Браузеры
  B->>Q: PUBLISH ecoshield/v1/buoy-02/audio (TLS, QoS 1)
  Q->>I: доставка (постоянная сессия)
  I->>I: zod, защита от повтора, magic bytes
  I->>D: INSERT audio_clips (pending)
  I->>A: POST /v1/audio/classify (таймаут 15 с)
  A-->>I: окна, top-k, спектрограмма
  I->>D: INSERT detections + alerts (триггер → realtime_events, NOTIFY)
  I-->>Q: PUBACK после COMMIT
  D-->>W: NOTIFY realtime (id события)
  W->>D: SELECT DTO тревоги
  W-->>U: SSE event alert, id = N
```

Гарантии доставки:

- `ingest` подтверждает сообщение MQTT только после коммита в БД (QoS 1, постоянная сессия). Обработка идемпотентна по `(device_id, boot_id, seq)`.
- Браузер переподключается к SSE с `Last-Event-ID`, и сервер досылает пропущенное из `realtime_events`.
- Если ML недоступен, клип встаёт в очередь, а тревога «неклассифицированное акустическое событие» создаётся сразу.

Итог: ни одно событие не теряется молча.

### 5.3 Структура репозитория и границы модулей

```
apps/web/                  Next.js (TS strict)
  src/app/                 тонкие маршруты: только композиция фич
  src/features/{alerts,sensors,forecast,audio,auth,audit,map,realtime,demo}/
      components/          UI фичи (client — только листья: карта, плеер, графики, формы)
      server/              queries.ts, actions.ts ('use server'), *.ts с import 'server-only'
      schemas.ts, dto.ts   zod-входы и минимальные DTO наружу
      index.ts             публичный API фичи (другие фичи импортируют только его)
  src/server/              db.ts, env.ts, dal.ts, authz.ts, errors.ts, logger.ts, ml-client.ts
  src/ui/                  токены и примитивы дизайн-системы
  src/i18n/                ru.ts, en.ts, format.ts (Intl, Europe/Moscow)
  src/proxy.ts             nonce-CSP, заголовки, оптимистичный редирект на /login
  src/instrumentation.ts   валидация env на старте, запуск LISTEN
services/ml/               FastAPI, uv, Python 3.13: audio/, forecast/, api/, tests/
services/ingest/           Node 24 + TS: mqtt/, rules/, clips/, forecast-job/, health
services/simulator/        Node 24 + TS: scenarios/*.json, publisher, control API (только внутренняя сеть)
packages/contracts/        zod-схемы: MQTT-сообщения, DTO, SSE-события; сгенерированные типы ML API
packages/db/               Drizzle-схема, SQL-миграции (роли, триггеры, PostGIS), сид
firmware/esp32/            PlatformIO (should)
edge/rpi/                  Python-агент буя (should)
infra/                     docker-compose.yml, Caddyfile, mosquitto/{conf,acl}, Dockerfile-ы
scripts/                   up.sh, gen-certs.sh, gen-device-creds.sh, fetch-data.sh (с sha256)
data/                      (в .gitignore) датасеты, клипы, модель, PMTiles; в git — только манифесты с чексуммами
docs/
compose.yaml               в корне: include infra/docker-compose.yml → `docker compose up` из корня
```

Правила границ:

- `features/*/server/**` импортирует `server-only`.
- Фича не лезет во внутренности другой фичи. ESLint `no-restricted-imports` пропускает только `features/x/index.ts`.
- Файлы в `app/` только вызывают фичи.

### 5.4 Ключевые решения

- **`ingest` на TypeScript (Node 24), не на Python.**
  - Схемы MQTT-сообщений описываются один раз в `packages/contracts` (zod). Их же используют симулятор и веб.
  - Три сервиса из четырёх на одном языке — меньше переключений для команды.
  - Клиенту `mqtt` 5.x можно отложить подтверждение сообщения до коммита в БД.
  - Воркер заодно ведёт фоновые задачи: очередь клипов с повтором при недоступном ML, джоб прогноза (раз в 6 ч и по запросу), детектор «устройство офлайн». Ещё один сервис ради них не нужен.
- **ORM — Drizzle**, драйвер `pg`.
  - SQL-подобный типизированный API без отдельного движка. У Prisma есть бинарный движок и слабая поддержка PostGIS.
  - Точки — встроенный тип `geometry`. Полигоны — `customType` и параметризованный `sql\`ST_GeomFromGeoJSON(${...})\``.
  - Миграции — обычные `.sql`, их удобно ревьюить. Роли, триггеры и NOTIFY пишем руками в SQL-миграциях.
- **Реальное время: LISTEN/NOTIFY + outbox `realtime_events` + SSE**, без Redis.
  - Экземпляр веба один, источник истины — БД.
  - В NOTIFY уходит только id: лимит полезной нагрузки 8000 байт, и так не утекают данные.
  - Redis понадобился бы для веерной рассылки между несколькими экземплярами, а у нас такого нет.
- **Caddy перед Next.js.**
  - Телефону нужен HTTPS: без него не работают `Secure`-cookie, геолокация и PWA.
  - Caddy отдаёт PMTiles с Range-запросами и не буферизует `text/event-stream`.
  - Один локальный CA (`scripts/gen-certs.sh`) выпускает сертификаты и для Caddy, и для Mosquitto, поэтому на телефон и устройства ставим один корневой сертификат.
- **Сети Docker.** `edge`: caddy ↔ web. `backend`: web, ingest, ml, postgres, mosquitto, simulator. В локальную сеть открыты только 443/80 (Caddy) и 8883 (MQTT/TLS).
- **TypeScript без сборки в сервисах.** Node 24 сам удаляет типы (`erasableSyntaxOnly` в tsconfig), workspace-пакеты экспортируют `.ts`, Next собирает их через `transpilePackages`. Если что-то не заведётся — `tsx` 4.23.15.

## 6. Демо-территория: заказник «Аграханский»

**Почему он.** Я проверил варианты через Overpass API:

| Кандидат | В OSM | Вывод |
|---|---|---|
| Дагестанский заповедник, участок «Кизлярский залив» | **нет** полигона с `boundary=protected_area` / `leisure=nature_reserve` в районе 43.3–45.0° с. ш., 46.4–48.2° в. д. | пришлось бы рисовать примерный полигон |
| Заказник «Аграханский» | `way/505346049`, `boundary=protected_area`, `protect_class=4` | **реальная граница**, нужна только атрибуция ODbL |
| Национальный парк «Самурский» | `relation/21188914`, `protect_class=2` | далеко на юге (~41.5–41.9° с. ш.), в стороне от района тюленя |

Аграхан к тому же стоит на побережье северо-западного Каспия, между дельтами Терека и Сулака. Рядом острова Чечень (`way/5227556`) и Яичный (`relation/14553380`), севернее — о. Тюлений (`relation/7635642`). Это кандидаты в места залёжек тюленя — **допущение A-S3**.

**Что кладём в PostGIS** (SRID 4326):

| Объект | Источник и пометка в UI |
|---|---|
| Граница заказника | полигон из OSM; в UI атрибуция «© участники OpenStreetMap, ODbL» |
| Операционная морская зона вокруг п-ова, ~43.55–44.20° с. ш., 47.30–48.00° в. д. | рисуем сами, в UI метка «иллюстративно» |
| Зоны режима: «зона покоя (демо)» с правилом `no_entry` и буфер | метка «демонстрационная зона» |
| 3 акустических буя и 3 водные станции | правдоподобные позиции: вход в залив, у островов, у устья Сулака |

Полигон OSM маленький (текст), поэтому сохраняем его в `infra/seed/geo/agrakhan.osm.geojson` с атрибуцией. Сид не зависит от доступности Overpass на площадке.

## 7. Прогноз: почему тюлень, а не нерест

**Аргументы** (биологические утверждения — допущения со ссылками, которые надо проверить):

1. **Сезон совпадает с демо.** Осенью тюлени возвращаются на север Каспия к льдам, где размножаются (A-S2). Прогноз на ближайшие 7 дней в ноябре осмыслен. Нерестовые миграции осетровых и полупроходных рыб в основном весенне-летние (A-F1). Ноябрьский прогноз нереста был бы почти пустым и выглядел бы неубедительно.
2. **Связь с основной историей демо — браконьерством.** В литературе гибель тюленей в незаконных сетях на осетра описывается как существенный фактор смертности (A-S4; Dmitrieva et al., 2013, PLoS ONE 8(6): e67074 — проверить). Патруль в районах скопления тюленей одновременно ищет сети. Наши акустические тревоги становятся фактором прогноза — «давлением» (§7.2).
3. **Охранный статус.** Каспийский тюлень в Красном списке МСОП имеет статус Endangered.
4. **Данные реально доступны для Каспия** (§7.1).

### 7.1 Источники данных: что проверено

| Фактор | Источник | Результат проверки 12.11.2026 | В UI |
|---|---|---|---|
| Ветер 10 м, t воздуха | Open-Meteo Forecast API | ✅ 168 часовых значений в точке 44.45° с. ш., 47.55° в. д. | реальные |
| Высота волн | Open-Meteo Marine API | ✅ полные ряды в 5 точках Каспия | реальные |
| t поверхности моря (SST) | Open-Meteo Marine | ❌ все значения `null`: Каспий вне маски океанской модели | — |
| SST | NOAA OISST v2.1, ERDDAP `ncdcOisst21Agg_LonPM180` | ✅ 14.6–18.0 °C в 3 точках. Последняя дата 27.10.2026, задержка ≈ 16 дней. На горизонт прогноза переносим последнее значение (допущение A-S6). | реальные, с задержкой |
| Уровень моря, течения | Open-Meteo Marine | ❌ `null`. DAHITI и Hydroweb требуют регистрации, не проверял. | синтетика: константа + прокси ветрового нагона |
| Солёность | — | открытого прогноза нет | синтетика: климатология по допущению A-S8 + IoT-датчики, если есть |
| Лёд | — | в ноябре в районе не актуален (A-S7) | правило по сезону |
| Инциденты | наша БД (тревоги за 30 дней) | — | реальные: демо-данные с пометкой «симуляция» |

### 7.2 Модель — прозрачная, без обучения на выдуманных метках

- **Почему без GBM.** Реальных наблюдений тюленей (учётов, телеметрии) у нас нет. Градиентный бустинг, обученный на синтетических метках, просто выучил бы наши же правила — это замкнутый круг. Поэтому берём сезонный базис и аддитивную шкалу факторов в логитах. Вклад каждого фактора в каждой ячейке считается точно и сразу даёт объяснение. Интерфейс модели оставляем таким, чтобы GBM можно было подставить, когда появятся настоящие данные учётов.
- **Формула.** `logit(p) = base(день года) + Σ wᵢ·fᵢ(x)`. Вклад каждого фактора показываем в процентных пунктах. Приоритет патруля = `p × (1 + давление)`, где давление — инциденты рядом за 30 дней.
- **Сетка.** Шестиугольники `ST_HexagonGrid` в UTM 38N (EPSG:32638), шаг ≈ 1.5–2 км. Сетку обрезаем по операционной зоне и переводим в 4326. В ячейке храним статические признаки: расстояние до кандидатных залёжек, до берега и до устьев рек.
- **Выход.** Для каждой ячейки на каждый из 7 дней: индекс присутствия 0–1, приоритет, уровень (низкий/средний/высокий), топ-3 вклада факторов со значениями и единицами.
- **Зоны патрулирования.** `ST_ClusterDBSCAN` по ячейкам с высоким приоритетом, объединение кластера в полигон, ранжирование с обоснованием.
- **Объяснение** строится по шаблонам (RU/EN), без LLM. Пример: «Выше всего вероятность у о. Чечень (≈ 0,7): сезон осенней миграции (+), слабый ветер благоприятен для залёжек (+). Вода 14,6 °C (по OISST на 27.10) — около сезонной нормы (≈ 0).»
- **Конфиг** `forecast/assumptions.yaml` версионируется. В нём веса и ссылка на допущение у каждого фактора. Фактор без задокументированного допущения запрещён (проверяется тестом).

### 7.3 Допущения о биологии и среде — для проверки экологами

| ID | Допущение | Как используется | Источник для проверки |
|---|---|---|---|
| A-S1 | Щенка на льдах северного Каспия — конец января – февраль | сезонный базис (зимний максимум к северу) | оценка МСОП по *Pusa caspica* |
| A-S2 | Весной тюлени расходятся в средний и южный Каспий, осенью мигрируют на север, в том числе вдоль западного побережья | сезонный базис для района Аграхана: осенний и весенний пики, летний минимум | Dmitrieva et al., 2016, MEPS 554 (проверить) |
| A-S3 | Острова Чечень, Яичный, Тюлений — **кандидаты** в осенние залёжки | фактор «расстояние до залёжки» | сотрудники заказника/заповедника |
| A-S4 | Прилов в незаконных сетях — значимая угроза | приоритет патруля = присутствие × давление | Dmitrieva et al., 2013 (проверить) |
| A-S5 | Сильный ветер и волнение снижают использование залёжек | отрицательный вклад ветра/волн, малый вес | экспертная оценка |
| A-S6 | SST меняется медленно; перенос значения на 7 дней допустим | фактор SST | сравнить с наблюдениями |
| A-S7 | Лёд в районе с декабря по март; в ноябре фактор неактивен | фактор «лёд/кромка» | ледовые карты |
| A-S8 | Распреснение у устьев влияет на кормовую базу | малый вес, климатологическая солёность | гидробиологи |
| A-F1 | Нерестовые миграции рыб — в основном весна – начало лета | только для обоснования выбора | ихтиологи |

## 8. Аудио-ИИ

- **Модель — YAMNet** (AudioSet, 521 класс) в формате TFLite, 3.9 МБ. Ссылки проверены: `download.tensorflow.org/.../lite-model_yamnet_classification_tflite_1.tflite` и class map CSV. Рантайм — `ai-edge-litert` (LiteRT), без TensorFlow в образе. Тот же файл модели и тот же маппинг работают на Raspberry Pi.
- **Окна** 0.96 с с шагом 0.48 с, 16 кГц, моно. На выходе по каждому окну:
  - оценки по нашим меткам `{boat_engine, gunshot, background}`;
  - топ-5 классов AudioSet;
  - список событий с временами и итог по клипу.
  
  Спектрограмма — log-mel в PNG. Палитра задаётся из токенов дизайна, без matplotlib.
- **Маппинг** лежит в версионируемом `audio/label_map.yaml`. На старте сервис сверяет имена классов с class map модели и падает при расхождении.

  | Наша метка | Классы AudioSet |
  |---|---|
  | `gunshot` | «Gunshot, gunfire», «Machine gun», «Fusillade», «Artillery fire» |
  | `boat_engine` | «Motorboat, speedboat», «Boat, Water vehicle», «Engine», «Idling», «Medium engine (mid frequency)», «Heavy engine (low frequency)» |
  | `background` | всё остальное |

  Точные индексы фиксируем по CSV.
- **Голова-классификатор** — только если останется время. Логистическая регрессия на эмбеддингах YAMNet. Эмбеддинги снимаем с промежуточного тензора LiteRT (`experimental_preserve_all_tensors`), это проверим. Иначе берём веса `yamnet.h5` (14.6 МБ, ссылка проверена) и TF 2.21 только на этапе обучения.
- **Пороги.** Для `gunshot` порог подбираем на валидации под высокую полноту: пропущенный выстрел дороже ложной тревоги. Компромисс — сколько ложных тревог мы за это платим — пишем в model card цифрами.
- **Данные и лицензии:**

  | Набор | Лицензия | Объём | Для чего |
  |---|---|---|---|
  | ESC-50 | CC BY-NC 3.0 | ~600 МБ | фон и трудные негативы: гроза, фейерверк, вертолёт, волны, ветер, `engine` |
  | UrbanSound8K | CC BY-NC 3.0 | 5.7 ГБ, ссылка проверена | `gun_shot` и `engine_idling` с готовыми фолдами — **если успеем скачать** |
  | Записи моторных лодок с Freesound / Wikimedia | CC0 / CC BY | по факту | реальные лодки: в ESC-50/US8K «двигатель» — автомобильный |
  | Наши записи | помечаем отдельно | по факту | — |

  Лицензия NC подходит для некоммерческого хакатона, указываем это явно.
- **Протокол оценки.**
  - Сплиты train/val/test фиксируются в манифесте с sha256 и делятся по группам: фолды US8K и ESC-50, источник записи.
  - Test не используется ни для обучения, ни для порогов.
  - Отчитываемся precision/recall/F1 по классам, матрицей ошибок, объёмами выборок и 95% доверительными интервалами (Уилсон).
  - Демо-клипы в test не входят, и в model card написано, как их отбирали.
  - Публикуем только измеренные числа.
- **Запасной вариант:** PANNs CNN14 (312 МБ, нужен PyTorch) — только если YAMNet не заведётся.

## 9. Модель данных (PostgreSQL 18 + PostGIS 3.7, SRID 4326)

```mermaid
erDiagram
  areas ||--o{ zones : "содержит"
  areas ||--o{ devices : "содержит"
  areas ||--o{ patrols : "содержит"
  areas ||--o{ forecast_cells : "покрыта"
  devices ||--o{ sensors : "имеет"
  sensors ||--o{ readings : "пишет"
  devices ||--o{ audio_clips : "присылает"
  audio_clips ||--o{ detections : "даёт"
  areas ||--o{ alerts : "в"
  alerts }o--o| zones : "в зоне"
  alerts }o--o| audio_clips : "улика"
  alerts }o--o| patrols : "назначен"
  alerts ||--o{ ml_feedback : "обратная связь"
  forecast_runs ||--o{ forecast_values : "значения"
  forecast_cells ||--o{ forecast_values : "ячейка"
  forecast_runs ||--o{ patrol_suggestions : "зоны"
  user ||--o{ session : "сессии"
  user }o--o| areas : "участок"
```

| Таблица | Ключевые поля | Индексы и ограничения |
|---|---|---|
| `areas` | slug, name_ru/en, kind, `boundary` MultiPolygon, `ops_area` Polygon, boundary_source (`osm:way/505346049`), attribution | GIST(boundary), GIST(ops_area) |
| `zones` | area_id, kind (`no_entry`/`restricted`/`buffer`), geom, is_illustrative, rules jsonb | GIST(geom) |
| `devices` | id (`buoy-02`), kind (`acoustic_buoy`/`water_station`), area_id, location Point, is_simulated, last_seen_at, boot_id, last_seq | GIST(location) |
| `sensors` | device_id, metric (`water_temp_c`, `conductivity_us_cm`, `tds_ppm`, `turbidity_ntu`, `salinity_psu`), unit, valid_min/max, thresholds jsonb | UNIQUE(device_id, metric) |
| `readings` | sensor_id, ts, value, quality (`ok`/`suspect`), seq | PK(sensor_id, ts) — «по датчику за время» в обе стороны |
| `audio_clips` | source (`device`/`upload`), device_id?, uploaded_by?, area_id, location?, recorded_at, duration_s, sample_rate, format, sha256, storage_key (случайное имя), spectrogram_key, status (`pending`/`processing`/`awaiting_ml`/`done`/`failed`), attempts, next_attempt_at, edge_hint jsonb | частичный (status, next_attempt_at) WHERE status IN ('pending','awaiting_ml') |
| `detections` | clip_id, label, confidence, start_s, end_s, top_classes jsonb, model_name/version, threshold | (clip_id) |
| `alerts` | area_id, zone_id?, kind, severity (`info`/`warning`/`critical`), priority, priority_reasons jsonb, status (`new`/`acknowledged`/`assigned`/`resolved`/`false_positive`), location, device_id?, clip_id?, detection_id?, related_alert_id?, title_key + params (i18n), dedup_key, occurrences, assigned_patrol_id?, acknowledged_by/at, assigned_by/at, closed_by/at, resolution_note, is_simulated, **version** | (area_id, status, created_at DESC); (status, severity, priority DESC, created_at DESC); GIST(location); UNIQUE(dedup_key) WHERE status IN открытые |
| `patrols` | area_id, call_sign, status | |
| `ml_feedback` | alert_id, clip_id, detection_id, model_version, predicted_label, verdict, corrected_label?, note, created_by | (created_at) |
| `forecast_cells` | area_id, geom (hex), centroid, static jsonb (расстояния) | GIST(geom) |
| `forecast_runs` | area_id, species, issued_at, valid_from, horizon_days, model_name/version, sources jsonb (реальные/синтетические, даты, покрытие), status, summary jsonb | (area_id, issued_at DESC) |
| `forecast_values` | run_id, cell_id, day, presence, priority, level, factors jsonb | PK(run_id, day, cell_id) |
| `patrol_suggestions` | run_id, day, rank, geom, score, rationale jsonb | (run_id, day, rank) |
| `hydro_cache` | source, point_key, variable, ts, value, fetched_at | PK(source, point_key, variable, ts) |
| `realtime_events` | id bigserial, at, type, area_id, payload jsonb (только id и версия) | хранение 24 ч |
| `service_heartbeats` | service, at, details jsonb (статус ML глазами ingest) | PK(service) |
| `audit_log` | id bigserial, at, actor_type (`user`/`system`/`device`), actor_id, actor_role, action, entity_type, entity_id, area_id, details jsonb (без секретов и ПДн), request_id, ip_hmac | (at DESC), (entity_type, entity_id), (actor_id, at) |
| `user`, `session`, `account`, `verification`, `rate_limit` | таблицы Better Auth; в `user` добавлены `role` (`input: false`) и `area_id` | |

**Роли БД (минимум привилегий):**

| Роль | Права |
|---|---|
| `ecoshield_owner` | DDL, только для миграций |
| `ecoshield_web` | чтение; запись статусов тревог, `ml_feedback`, загрузок, таблиц Better Auth; только INSERT в `audit_log` |
| `ecoshield_ingest` | запись readings, клипов, детекций, тревог, прогнозов; только INSERT в `audit_log` |

`audit_log` защищён двумя способами: у всех ролей приложения отозваны `UPDATE/DELETE/TRUNCATE`, а триггер `BEFORE UPDATE OR DELETE` бросает исключение. Триггеры на `alerts` и `devices` пишут в `realtime_events` и делают `pg_notify('realtime', id)`.

## 10. Контракты API

Каждая схема описана один раз. В TypeScript — zod в `packages/contracts`, валидируется на каждой границе. В Python — Pydantic в `services/ml`, оттуда генерируются OpenAPI и TS-типы.

### 10.1 MQTT (TLS :8883, QoS 1, лимит сообщения 1 МБ)

| Топик | Кто пишет | Полезная нагрузка (JSON, `v: 1`) |
|---|---|---|
| `ecoshield/v1/{deviceId}/telemetry` | водная станция | `deviceId, bootId, seq, ts, readings{water_temp_c?, tds_ppm?, conductivity_us_cm?, turbidity_ntu?}, battery_v?, rssi_dbm?` |
| `ecoshield/v1/{deviceId}/status` | любое устройство (retained, LWT) | `deviceId, bootId, seq, ts, state: online/offline, fw` |
| `ecoshield/v1/{deviceId}/audio` | акустический буй | `deviceId, bootId, seq, ts, clip{format: wav, sampleRate: 16000, durationS ≤ 30, sha256, dataB64}, edge?{model, version, label, confidence}` |

**ACL:**
- устройство: `pattern write ecoshield/v1/%u/#` — только свой топик;
- `ingest`: `read ecoshield/v1/+/#`;
- анонимный доступ запрещён.

Пароли хранятся в формате `mosquitto_passwd` и генерируются скриптом. У симулятора свои учётки `sim-*` — те же правила, что у железа.

**Проверки в `ingest`:**
- топик, `deviceId` в сообщении и устройство в реестре совпадают;
- `(bootId, seq)` строго растёт;
- `|ts − now| ≤ 5 мин` для устройств с синхронизированным временем;
- физические диапазоны: t воды −2…40 °C, электропроводность 0…60 000 мкСм/см, мутность 0…4000 NTU (уточним по датчикам). Выход за диапазон помечает показание `suspect` и создаёт тревогу «датчик под подозрением»;
- у аудио: magic bytes, размер и длительность.

### 10.2 Веб (Next.js)

**Страницы** (все защищённые маршруты проходят через DAL):

| Маршрут | Роли | Содержимое |
|---|---|---|
| `/login` | все | вход |
| `/` | все | дашборд: карта + лента + контекстная панель; `?alert=<id>` открывает карточку в панели или листе |
| `/alerts`, `/alerts/[id]` | все (свой участок) | полный список (доступная альтернатива карте) и карточка (глубокая ссылка) |
| `/sensors`, `/sensors/[id]` | все | устройства, статусы, графики |
| `/forecast` | все | слой прогноза, выбор дня, зоны патрулирования, объяснение |
| `/audio` | все | загрузка и анализ аудио |
| `/audit` | supervisor, admin | журнал аудита |
| `/admin` | admin; пороги датчиков — supervisor | пользователи и роли, пороги, управление сценарием |

**Server Actions.** Каждый вызов проходит одну цепочку: zod-валидация → `requireUser` → `authorize(роль, участок)` → операция → аудит → минимальный DTO. Результат — `{ ok: true, data } | { ok: false, error: 'invalid' | 'forbidden' | 'not_found' | 'conflict' }`.

- `acknowledgeAlert({alertId, version})`
- `assignPatrol({alertId, patrolId, version})`
- `resolveAlert({alertId, note?, version})`
- `markFalsePositive({alertId, note?, correctedLabel?, version})`
- `updateSensorThresholds` (supervisor+)
- `setUserRole` (admin)
- `refreshForecast` (supervisor+)
- `startScenario`, `resetDemo` (admin)

**Route Handlers.** Сессия проверяется в каждом; для Route Handler ещё проверяем `Origin`.

| Endpoint | Что делает |
|---|---|
| `GET /api/stream` | SSE |
| `POST /api/audio` | загрузка, потоковая проверка лимита |
| `GET /api/clips/[id]/audio` | отдаёт клип с Range/206 — без этого iOS Safari не проигрывает |
| `GET /api/clips/[id]/spectrogram` | PNG спектрограммы |
| `GET /api/map/{areas,devices,alerts}` | GeoJSON |
| `GET /api/forecast/[runId]?day=` | GeoJSON прогноза |
| `GET /api/health` | здоровье сервиса |
| `/api/auth/[...all]` | Better Auth |

**SSE-события:**
- `alert` — `{op: created|updated, alert: AlertDTO}`;
- `device` — `{deviceId, status, lastSeenAt}`;
- `reading` — `{sensorId, ts, value, quality}`;
- `system` — `{ai: ok|degraded, ingest: ok|stale}`;
- комментарий-heartbeat каждые 15 с.

У событий, которые можно доотправить, `id:` равен `realtime_events.id`.

### 10.3 ML-сервис (только внутренняя сеть, `Authorization: Bearer <ML_API_TOKEN>`)

| Метод | Вход | Выход |
|---|---|---|
| `GET /healthz` | — | `{status, modelLoaded, modelVersion}` |
| `GET /v1/models` | — | имя, версия, sha256 модели, версия маппинга, пороги, ссылка на метрики |
| `POST /v1/audio/classify` | тело — байты аудио (`application/octet-stream`, ≤ 10 МБ), `?topK=5&spectrogram=true` | `{model, durationS, sampleRate, windows[{startS, endS, scores{boat_engine, gunshot, background}, topK[{name, score}]}], events[{label, confidence, startS, endS}], summary{label, confidence, qualitative}, spectrogramPng?}` |
| `POST /v1/forecast/seal` | `{areaId, issuedAt, horizonDays: 7, cells[{cellId, lat, lon, static…}], hydrology[{date, pointKey, wind…, wave…, sst…, source, synthetic}], incidents[…]}` | `{model, cells[{cellId, days[{date, presence, priority, level, factors[{name, value, unit, contribution}]}]}], summary{ru, en}, sources}` |

Коды ошибок: 413 (размер), 415 (тип по magic bytes), 422 (не декодируется или слишком длинный), 504 (таймаут 15 с). Стектрейсы наружу не отдаются никогда.

### 10.4 Кодогенерация

`pnpm gen:ml-types`: FastAPI отдаёт `openapi.json`, `openapi-typescript` генерирует `packages/contracts/src/ml-api.d.ts`. CI падает, если сгенерированный файл устарел.

Ответ ML валидирует сам ML-сервис (Pydantic `response_model`). Потребитель дополнительно проверяет поля, от которых зависят решения: перечисление меток и диапазон уверенности 0–1.

## 11. Интерфейс: экраны, раскладки, компоненты

**Раскладки:**

| Ширина | Раскладка |
|---|---|
| телефон ≥ 360 px | карта во весь экран, лента в перетаскиваемом нижнем листе (3 положения + кнопка для клавиатуры), основные действия в зоне большого пальца, цели ≥ 44×44 |
| планшет ≥ 768 px | карта + сворачиваемая боковая панель |
| десктоп ≥ 1280 px | карта + лента + контекстная панель (карточка, графики, прогноз); горячие клавиши в фокусе ленты: `j/k`, `a`, `p`, `r`, `f`, `Enter`, `?` |

Компоненты в панелях разной ширины адаптируются через container queries (Tailwind 4).

**Ключевые компоненты:**

| Группа | Компоненты |
|---|---|
| Карта | `MapView` (client, lazy), `LayerToggle`, `MapLegend` |
| Лента и тревоги | `AlertFeed`, `AlertItem`, `AlertDetail`, `AlertActions`, `PriorityExplainer` |
| Индикаторы | `SeverityBadge` (иконка + текст + цвет), `ConfidenceMeter` (% + «высокая/средняя/низкая уверенность») |
| Аудио | `SpectrogramPlayer` (плейхед поверх PNG), `UploadDropzone` |
| Датчики | `SensorChart` (uPlot, lazy) |
| Прогноз | `ForecastLayer`, `DaySelector`, `PatrolZoneList` |
| Каркас | `BottomSheet`, `SidePanel`, `StatusBar` (связь, свежесть «обновлено 4 мин назад», статус ИИ) |
| Журнал | `AuditTable` |
| Состояния | `Skeleton*`, `EmptyState`, `ErrorState` (с повтором), `StaleBanner`, `AiDegradedBanner` |

**Состояния каждого представления данных:**
- скелетон по форме итоговой раскладки;
- пустое состояние со следующим действием;
- ошибка с повтором;
- офлайн или устаревшие данные;
- ИИ недоступен.

**Тексты.** Формулировки вида «ИИ предполагает: выстрел (93 %, высокая уверенность). Решение — за инспектором».

**Форматы:** единицы (°C, PSU, NTU, мкСм/см, м, дБ), ru-RU, время в Europe/Moscow плюс относительное. Координаты и показания — моноширинным шрифтом с табличными цифрами.

## 12. Безопасность — сводка (STRIDE — в `docs/SECURITY.md` на этапе polish)

- **Доступ (A01).**
  - DAL (`src/server/dal.ts`, `server-only`): `requireUser`, `requireRole`, `assertAreaAccess` и матрица прав в `authz.ts`. Через неё проходят все страницы, Server Actions и Route Handlers.
  - `proxy.ts` делает только оптимистичный редирект, если нет cookie сессии. Это никогда не единственная проверка.
  - Server Action считаем публичным POST: zod, сессия, роль, участок, версия, минимальный DTO.
  - Чужой участок возвращает 404, чтобы не раскрывать, что ресурс существует.
- **Аутентификация (A07).** Better Auth.
  - Email и пароль; публичная регистрация выключена (`disableSignUp`).
  - Пароли хешируются argon2id (`@node-rs/argon2` через `password.hash/verify`).
  - Сессии хранятся в БД с TTL 12 ч (смена).
  - Cookie: `__Secure-`, HttpOnly, Secure, SameSite=Lax.
  - Rate limit входа хранится в БД (5 неудачных попыток за 10 мин).
  - Роль — дополнительное поле `input: false`, сам пользователь её поставить не может.
  - Телеметрия Better Auth и Next.js выключена.
- **CSP: nonce, а не hash.**
  - В 16.4.6 nonce работает только при рендеринге на каждый запрос. Документация: «all pages must be dynamically rendered», оболочка PPR несовместима.
  - Хеш-вариант (`experimental.sri`) помечен экспериментальным и «cannot handle dynamically generated scripts».
  - Наши страницы персональные (сессия, роль, участок), поэтому и так рендерятся на запрос. Статическая оболочка почти ничего не даёт, а nonce даёт строгий `script-src 'self' 'nonce-…' 'strict-dynamic'` без `unsafe-inline` и `unsafe-eval`.
  - Cache Components оставляем ради `'use cache'` + `cacheTag` для общих справочных данных: границы, зоны, патрули. Это кэш данных, а не HTML; персональные данные в общий кэш не попадают.
  - Корневой layout помечаем `instant = false` (сегменту разрешено блокировать).
  - В Фазе 1 проверяем на прод-сборке: Playwright ловит `securitypolicyviolation`, нарушений должно быть 0. Запасной вариант — `cacheComponents: false`.
  - `style-src 'self' 'unsafe-inline'` — осознанно принятый риск: SSR-атрибуты `style` у React, Radix и MapLibre. Внедрение CSS гораздо менее опасно, чем внедрение скриптов. Описываем в SECURITY.md.
  - Для воркера MapLibre используем CSP-сборку с воркером по URL, чтобы обойтись без `blob:`; если не выйдет — `worker-src 'self' blob:`.
- **Заголовки (A02):**
  - HSTS;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy: geolocation=(self), microphone=(), camera=(), …` — микрофон откроем, только если добавим запись в браузере;
  - `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`, `form-action 'self'`.

  В проде — без подробных ошибок: в Next.js только digest, в FastAPI — свой обработчик.
- **Секреты.**
  - `.env` создаётся скриптом со случайными значениями, в git только `.env.example`.
  - env валидируется на старте каждого сервиса (zod / pydantic-settings), при ошибке — немедленное падение.
  - `NEXT_PUBLIC_*` — только несекретное (путь к тайлам).
  - Сборка проверяется на попадание значений секретов в `.next/static`.
- **Цепочка поставок (A03):**
  - pnpm 12 с закоммиченным lockfile и точными версиями;
  - сборочные скрипты зависимостей — только из allow-list;
  - `pnpm audit` и `pip-audit`: 0 high/critical;
  - GitHub Actions закреплены по SHA;
  - каждая зависимость обоснована (§16).
- **Инъекции (A05).** Только параметризованные запросы (Drizzle и `sql` с плейсхолдерами), без конкатенации SQL. Без `dangerouslySetInnerHTML` для недоверенных данных. SVG от пользователей не принимаем, `images.dangerouslyAllowSVG` выключено.
- **Загрузки.**
  - Только wav/mp3/flac/ogg, тип проверяется по magic bytes на вебе и повторно в ML.
  - Не больше 10 МБ (потоковый счётчик плюс лимит в Caddy) и 60 с.
  - Файл сохраняется в том `clips` под случайным именем, не из имени файла пользователя.
  - Отдаётся только через авторизованный маршрут с `nosniff`.
  - Декодирование в ML с таймаутом 15 с.
  - Rate limit — 10 загрузок в минуту на пользователя.
- **IoT (A08).** TLS, учётки на устройство, ACL, zod и физические диапазоны, `(bootId, seq)` и окно времени против повтора, `suspect` вместо слепого доверия. Подпись сообщений HMAC — осознанно принятый риск: брокер наш.
- **Журналирование (A09).**
  - Append-only `audit_log`.
  - Пишем: входы и неудачи, выходы, смену статусов тревог, назначения, смену ролей, изменение порогов, старт и сброс сценария, обновление прогноза.
  - Без паролей, токенов и cookie; IP хранится только как HMAC.
  - Логи сервисов — JSON без ПДн.
- **Отказы (A10).** ML упал — видны датчики, баннер «ИИ недоступен», клипы стоят в очереди, тревога создаётся без классификации. Ни одна тревога не теряется молча (§5.2).
- **Приватность и 152-ФЗ.** Минимум ПДн: имя, роль, участок и рабочий email для входа. Никакой сторонней аналитики. Шрифты, тайлы и глифы — только свои. Браузер не делает ни одного запроса к третьим сторонам (проверяем в Playwright).

## 13. Производительность: бюджет и как меряем

| Метрика | Цель | Как меряем |
|---|---|---|
| LCP / CLS на дашборде | ≤ 2.5 с / ≤ 0.1 | Lighthouse 13.6 (мобильный профиль) на `next build && next start` за Caddy, cookie сессии через `--extra-headers` |
| INP | ≤ 200 мс | Lighthouse — это лабораторный замер, он показывает TBT. INP снимаем `web-vitals` в сценарии Playwright (клик по тревоге, смена статуса) |
| Lighthouse Accessibility / Best Practices | ≥ 95 на всех страницах | там же |
| Lighthouse Performance | ≥ 90 без карты, ≥ 80 на карте | там же |
| Задержка «событие → тревога на экране» | ≤ 3 с, p95 из 10 прогонов | e2e-тест: метка времени у симулятора и в браузере |
| First-load JS `/login`, `/alerts` | минимизировать, отчёт | `pnpm next analyze`, три крупнейших чанка с объяснением |
| Карта | векторные тайлы, кластеризация, без перерисовки | `GeoJSONSource.updateData`/`setData` без перерендера React-компонента карты; MapLibre подгружается через `dynamic import` после первой отрисовки |
| БД | горячие запросы по индексу | `EXPLAIN` в тесте для: тревоги по статусу и времени, показания по датчику и времени, пространственные запросы |

Все числа — только измеренные, в `docs/PERF.md`.

## 14. Дизайн-направление: морская приборная панель

- **Токены** (CSS-переменные). Значения ниже стартовые, контраст выверим в фазе polish.

  | Токен | Тёмная тема (по умолчанию, ночь) | Светлая высококонтрастная (солнце) |
  |---|---|---|
  | фон / поверхность / приподнятая | чернильно-синий `#07111C` / `#0B1A2A` / `#12263A` | соль `#F7F9FA` / белый / `#E6ECEF` |
  | текст / вторичный | соль `#E9EEF1` / песок `#CDBB94` | чернила `#06121C` / `#3A4A57` |
  | бренд | каспийская бирюза `#1FA39A` | `#0B6E68` |
  | сигнальный акцент (внимание, фокус) | «международный оранжевый» `#FF6A13` — цвет спасательных средств | `#C24400` |
  | info / warning / critical (только для тревог) | `#4CB8E6` / `#F5B400` / `#FF4B3E` | затемнённые варианты |

  Severity никогда не передаётся только цветом: рядом всегда иконка lucide и текст.
- **Шрифты:** IBM Plex Sans (variable) для интерфейса и IBM Plex Mono для показаний и координат. Почему:
  - одно суперсемейство с общей метрикой — цельный «инженерный» характер прибора;
  - полная кириллица в обоих;
  - табличные цифры (`tnum`);
  - высокая разборчивость на малых размерах;
  - OFL.

  Подключаем через `@fontsource-*` и `next/font/local`: файлы шрифтов свои, сборка не ходит в Google Fonts. Display-шрифта нет.
- **Движение.**
  - Новая критическая тревога пульсирует кольцом на карте (3 цикла, затем стоит) и въезжает в ленту (200 мс).
  - Панели открываются за 180–240 мс с ease-out.
  - При `prefers-reduced-motion` анимаций нет.
- **Карта.** Стиль Protomaps, перекрашенный в наши токены, подписи на русском (`lang: 'ru'`). Глифы Noto Sans в PBF с кириллическими диапазонами и спрайты лежат локально. PMTiles-вырезка района ~43.3–44.7° с. ш., 46.8–48.3° в. д.
- **Чего избегаем:** фиолетовых градиентов, повсеместного glassmorphism, эмодзи вместо иконок, сеток одинаковых карточек, lorem ipsum.

## 15. Сценарий демо (3 минуты)

**За 10 минут до старта.** Стек поднят из тега. Телефон подключён к точке доступа ноутбука и вошёл как инспектор. Ноутбук вошёл как супервайзер. Прогноз рассчитан заранее на кэше.

| Время | Что происходит | Что видят судьи |
|---|---|---|
| 0:00 | Вступление | На обоих устройствах карта Аграхана: граница из OSM, иллюстративные зоны, датчики с живыми показаниями (°C, NTU, мкСм/см), статус «ИИ: в норме» |
| 0:20 | Супервайзер: «Запустить сценарий „Ночной браконьер“» (admin) | Симулятор публикует события по MQTT/TLS с учёткой буя — путь тот же, что у реального железа |
| 0:25 | buoy-02 в «зоне покоя (демо)» присылает клип мотора лодки | За ≤ 3 с на обоих устройствах появляется тревога **warning** «Моторная лодка в зоне покоя» с уверенностью в % и словами; на экране — бейдж задержки |
| 0:45 | Тот же буй присылает клип выстрела | **critical** «Выстрел», связан с тревогой о лодке (≤ 15 мин, ≤ 3 км), повышение приоритета с объяснением; пульс на карте; объявление через aria-live |
| 1:00 | Инспектор на телефоне открывает тревогу | Плеер и спектрограмма с плейхедом, топ классов («Gunshot, gunfire» — реальное значение модели), модель и версия, датчики рядом, формулировка «ИИ предполагает…» |
| 1:20 | «Принять» → «Назначить патруль „Терек-2“» | Ноутбук обновляется мгновенно, в журнале аудита записи «кто, когда, что» |
| 1:40 | Ложное срабатывание | В сценарии есть клип грозы или фейерверка, который **реальная** модель ошибочно отмечает как выстрел (берём настоящий FP из валидации). Инспектор помечает «ложное срабатывание» → запись в `ml_feedback` для дообучения. Тревогу о лодке закрываем «решено» с комментарием |
| 2:05 | Экран прогноза | Слой на 7 дней, переключаем на 3-й день, зоны патрулирования по рангам. Объяснение простыми словами и бейджи источников: «ветер, волны — Open-Meteo (реальные); SST — NOAA OISST (реальные, на 27.10); солёность — синтетика» |
| 2:35 | Устойчивость | `docker compose stop ml` → баннер «ИИ недоступен», новый клип даёт тревогу «неклассифицированное событие». `start ml` → тревога переклассифицирована |
| 3:00 | Конец | — |

**Честность сценария.**
- Слово «ночь» в сюжете — это нарратив. Правило «тёмное время суток» (высота солнца < −6°) реально повышает приоритет. Если демо днём, в объяснении приоритета будет «светлое время: без надбавки».
- Демо-клипы отобраны как чистые примеры, и об этом сказано в model card. Метрики — только на test.

**Бэкап:** видеозапись полного прогона, сделанная за 4 ч до демо, и скриншоты в слайдах.

## 16. Зависимости (точные версии фиксируются в `package.json` / `uv.lock`)

| Пакет | Где | Зачем (одна строка) |
|---|---|---|
| next 16.4.6 | web | фреймворк; ≥ 16.4.1 из-за трёх advisories |
| react, react-dom 19.3.1 | web | требуются Next 16.4 |
| better-auth 1.7.22 | web | поддерживаемая auth-библиотека: сессии в БД, rate limit, свой хеш, адаптер Drizzle |
| @node-rs/argon2 2.2.2 | web | argon2id с готовыми нативными бинарями (без node-gyp) |
| drizzle-orm 0.45.4 | web, ingest, db | типизированный SQL-first ORM с параметризацией, дружит с PostGIS через `sql` |
| pg 8.23.1 | web, ingest, db | самый проверенный драйвер Postgres + LISTEN/NOTIFY |
| zod 4.6.7 | все TS | единые схемы и валидация на границах |
| mqtt 5.16.1 | ingest, simulator | MQTT 5 с TLS, переподключением и подтверждением после обработки |
| maplibre-gl 6.18.0 | web | открытый WebGL-рендер векторной карты без ключей и трекинга |
| pmtiles 4.5.0 | web | чтение локального архива тайлов Range-запросами |
| @protomaps/basemaps 5.7.2 | web | слои базовой карты с русскими подписями под наши токены |
| uplot 1.6.32 | web | быстрые компактные графики показаний (canvas) |
| radix-ui 1.8.1 | web | доступные примитивы (Dialog, Tabs, Tooltip) под компоненты shadcn |
| lucide-react 1.72.0 | web | SVG-иконки с tree-shaking вместо эмодзи |
| server-only 0.0.1 | web | ломает сборку, если серверный модуль попал в клиент |
| @fontsource-variable/ibm-plex-sans, @fontsource/ibm-plex-mono 5.3.0 | web | файлы шрифтов с кириллицей для `next/font/local` |
| tailwindcss, @tailwindcss/postcss 4.3.5 | web (build) | стили на CSS-переменных, container queries из коробки |
| shadcn 4.23.0 (CLI) | web (dev) | копирует исходники компонентов в репозиторий; в рантайме не участвует |
| typescript 6.0.3 | dev | 7.x несовместим с typescript-eslint |
| eslint 10.14.0 + eslint-config-next 16.4.6 | dev | правила Next, React, Hooks, a11y и границы модулей |
| prettier 3.10.1 | dev | единое форматирование |
| vitest 5.1.0 | dev | юнит-тесты TS |
| @playwright/test 1.65.0 | dev | e2e, скриншоты, замер задержки, проверка CSP и сторонних запросов |
| lighthouse 13.6.0 | dev | замер CWV и оценок |
| openapi-typescript 7.13.0 | dev | TS-типы ML API из OpenAPI |
| drizzle-kit 0.31.11 | dev | генерация SQL-миграций |
| lefthook 2.2.2 | dev | pre-commit: формат, линт, gitleaks |
| @types/node (24.x), @types/react, @types/pg | dev | типы |
| fastapi 0.162.5 · uvicorn 0.54.0 | ml | HTTP API с OpenAPI · ASGI-сервер |
| pydantic 2.14.3 · pydantic-settings 2.16.2 | ml | схемы и валидация · проверка env на старте |
| numpy 2.5.4 | ml | массивы для окон и спектрограмм |
| ai-edge-litert 2.3.0 | ml, rpi | рантайм TFLite для YAMNet без TensorFlow; тот же на RPi |
| soundfile 0.14.0 · soxr 1.1.0 | ml | декодирование wav/flac/ogg/mp3 · ресемплинг в 16 кГц |
| pillow 13.0.0 | ml | PNG спектрограммы |
| scikit-learn 1.9.1 | ml | метрики, доверительные интервалы, логистическая голова (опционально) |
| pytest 9.2.0 · ruff 0.17.4 · httpx 0.28.1 | ml (dev) | тесты · линт и формат · TestClient FastAPI |
| образы postgis 18-3.7, mosquitto 2.0.22, caddy 2.11.9-alpine, node 24.22.3-trixie-slim, python 3.13.18-slim-trixie | infra | §2 |
| go-pmtiles 1.31.2 (CLI), gitleaks (образ в CI) | setup/CI | вырезка района · поиск секретов |

**Сознательно не берём:**

| Что | Почему |
|---|---|
| Redis | §5.4 |
| next-intl | хватает Intl API и типизированных словарей; плюральные формы через `Intl.PluralRules` |
| vaul | не обновлялся с 1.1.2; свой нижний лист — около 150 строк |
| toast-библиотеки | — |
| h3-js | сетка строится в PostGIS |
| TensorFlow / PyTorch в рантайме | хватает LiteRT |
| @next/bundle-analyzer | только для webpack; есть встроенный `next analyze` |
| tsx | Node 24 сам удаляет типы |
| Prisma | §5.4 |
| python-multipart | ML принимает сырые байты |

## 17. Риски и запасные варианты

| # | Риск | Вероятность / влияние | Что делаем | Запасной вариант |
|---|---|---|---|---|
| R1 | Телефон не доверяет локальному CA (iOS требует явно включить доверие) | средн. / высок. | инструкция в README; ставим CA накануне и проверяем | мобильная вёрстка в окне 375 px на ноутбуке; VPS с Let's Encrypt, если будет интернет |
| R2 | Wi-Fi площадки | высок. / высок. | точка доступа ноутбука, всё локально, образы собраны заранее, прогноз из кэша | — |
| R3 | Модель ошибается на демо-клипах | средн. / высок. | отбираем клипы, которые **реальная** модель распознаёт верно (замер), раскрываем это | второй комплект клипов; подделку результата не делаем никогда |
| R4 | Из YAMNet TFLite не достаются эмбеддинги | средн. / низк. | маппинг классов AudioSet без обучения закрывает must-have | TF 2.21 только для офлайн-обучения головы |
| R5 | Nonce-CSP конфликтует с Cache Components | средн. / средн. | `instant = false` на корне; проверка на прод-сборке в Фазе 1 | `cacheComponents: false` + кэш справочника в процессе |
| R6 | Не успеваем скачать UrbanSound8K (5.7 ГБ) | средн. / средн. | качаем сейчас, по проводу | ESC-50 + отобранные CC0-клипы; честно меньшая выборка и широкие интервалы |
| R7 | У тиммейта ARM (Apple Silicon): образ PostGIS только amd64 | средн. / средн. | демо на этом x86_64-ноутбуке | `imresamu/postgis:18-3.6` (multi-arch) через override-файл |
| R8 | ML-сервис падает на демо | низк. / средн. | `restart: unless-stopped`, healthcheck | режим деградации сам по себе — часть демо |
| R9 | ESP32 и TLS (сертификаты, память) | средн. / низк. (should) | CA вшит в прошивку, MQTT 3.1.1/TLS 1.2 | данные воды идут из симулятора с пометкой «симуляция» |
| R10 | Нехватка времени | высок. / высок. | вертикальные срезы, `main` всегда показываемый, теги | план сокращений (§18) |
| R11 | Overpass, Open-Meteo, NOAA недоступны на площадке | высок. / низк. | полигон в репозитории, кэш гидрологии | синтетика с явной меткой |
| R12 | Удаление типов в Node 24 не работает с workspace-пакетами | низк. / низк. | проверка за 5 мин в Фазе 1 | `tsx` |
| R13 | Lighthouse на странице карты < 80 | средн. / средн. | ленивая карта, LCP-элемент рендерится на сервере | честно показываем цифру и план улучшения |
| R14 | Утечка секрета в git | низк. / высок. | gitleaks в pre-commit и CI | процедура: сообщить → ротировать → чистить историю |
| R15 | pnpm 12 / MapLibre 6 — новые мажорные версии, могут быть неочевидные изменения | средн. / низк. | читаем release notes и типы перед кодом | откат на pnpm 10 / MapLibre 5 |

## 18. План задач (48 ч, параллельные треки)

**Треки:**
- **P** — платформа и бэкенд;
- **W** — веб и UI;
- **M** — ML;
- **H** — железо;
- **D** — дизайн, QA и питч.

ИИ-агенты работают в отдельных git worktree на своих ветках. Окна в колонке «T+, ч» указаны от момента согласования плана.

| # | Задача | Фичи | Трек | Оценка | T+, ч |
|---|---|---|---|---|---|
| 0 | Ответы на вопросы. Установка Docker (демон), Node 24, pnpm 12, uv, gh. Репозиторий на GitHub. Скачать UrbanSound8K и ESC-50 по проводу | — | все | 1 ч | 0–1 |
| 1 | Bootstrap: корневой коммит, `.gitignore`/`.gitattributes`, CONTRIBUTING, lefthook + gitleaks, CI, правила `main` | F01 | P | 2 ч | 1–3 |
| 2 | Compose: postgis, mosquitto (TLS, ACL), caddy (TLS), заглушки сервисов, healthchecks, `up.sh`, локальный CA, учётки устройств | F02 | P | 3 ч | 1–4 |
| 3 | `packages/db`: схема, миграции, роли БД, триггеры (append-only, NOTIFY), сид (Аграхан из OSM, устройства, пользователи, история) | F02 | P | 3 ч | 3–6 |
| 4 | Скелет Next.js: `proxy.ts` (nonce-CSP, заголовки), env, Better Auth (argon2id, роли), DAL, `/login`, пустая офлайн-карта | F03, F04 | W | 4 ч | 3–7 |
| 5 | Скелет ML: FastAPI, `/healthz`, `/v1/models`, загрузка YAMNet, OpenAPI → TS | F10 | M | 2 ч | 1–3 |
| 6 | `fetch-data.sh` (датасеты, модель, PMTiles, sha256), манифест сплитов | F13, F04 | M | 2 ч | 3–5 |
| ✔ | **Чекпойнт 1, T+8: walking skeleton** — всё поднимается одной командой, вход работает, карта рисуется, `pnpm check` и CI зелёные | | | | 8 |
| 7 | ingest: MQTT/TLS, zod, защита от повтора, диапазоны, readings, статусы устройств | F05 | P | 3 ч | 8–11 |
| 8 | Правила аномалий (медиана/MAD, скорость изменения, пороги), дедупликация | F06 | P | 2 ч | 11–13 |
| 9 | Realtime: outbox, NOTIFY → SSE с доотправкой, heartbeat, индикатор устаревания | F07 | W | 3 ч | 8–11 |
| 10 | Лента (база), слои карты (устройства, тревоги, кластеры) | F08, F04 | W | 3 ч | 11–14 |
| 11 | Симулятор: сценарий, CLI, управление из admin | F09 | P | 2 ч | 10–12 |
| 12 | Классификация: окна, маппинг, спектрограмма, magic bytes, таймаут, тесты | F10 | M | 4 ч | 5–9 |
| 13 | Оценка: валидация и test, пороги, метрики, черновик MODEL_CARD | F13 | M | 4 ч | 9–13 |
| ✔ | **Чекпойнт 2, T+14:** сценарий даёт тревогу на двух устройствах за ≤ 3 с | | | | 14 |
| 14 | Аудио-пайплайн: клипы → очередь → ML → детекции → правила (зона, ночь, корреляция); деградация | F11 | P | 4 ч | 14–18 |
| 15 | Загрузка аудио и экран результата | F12 | W | 2 ч | 16–18 |
| 16 | Карточка тревоги: плеер и спектрограмма, top-k, датчики рядом, история | F14 | W | 3 ч | 18–21 |
| 17 | Жизненный цикл: машина состояний, Server Actions, оптимистичная блокировка, патрули, FP → `ml_feedback`, горячие клавиши | F15 | W+P | 3 ч | 18–21 |
| 18 | Журнал аудита: страница и тест append-only | F16 | P | 1.5 ч | 21–22.5 |
| 19 | Модель прогноза: сетка, факторы, базис, данные (Open-Meteo, OISST, кэш, синтетика), API | F17 | M | 6 ч | 13–19 |
| ✔ | **Чекпойнт 3, T+23:** шаги 1–3 демо-истории работают end-to-end | | | | 23 |
| 20 | Экран прогноза: слой, день, зоны, объяснение | F18 | W | 4 ч | 23–27 |
| 21 | Безопасность: проверка заголовков и CSP, ошибки, роли БД, SECURITY.md (STRIDE) | F19 | P | 3 ч | 23–26 |
| 22 | Адаптив (нижний лист, панель, 3 колонки), темы, все состояния данных | F20 | W+D | 5 ч | 27–32 |
| 23 | Доступность | F21 | W+D | 2 ч | 32–34 |
| 24 | Производительность: Lighthouse, `next analyze`, индексы, задержка | F22 | W | 3 ч | 34–37 |
| ✔ | **Чекпойнт 4, T+37: все must-have, заморозка функционала** | | | | 37 |
| H1 | ESP32: датчики → MQTT/TLS (контракт заморожен в Фазе 1) | F24 | H | 8 ч | 2–20 |
| H2 | RPi-буй: микрофон, YAMNet на краю, отправка клипов | F25 | H+M | 8 ч | 8–28 |
| 25 | Английская локаль | F26 | W | 2 ч | 37–39 |
| 26 | PWA: manifest, SW, офлайн-индикатор, кэш тайлов | F27 | W | 3 ч | 37–40 |
| 27 | Документы, демо-скрипт, вопросы жюри, видео-бэкап, 3 прогона | F23 | D | 4 ч | 40–44 |
| 28 | Финальный тег `demo-N` (после вашего одобрения), буфер | — | все | 4 ч | 44–48 |

**План сокращений.** Режем сверху вниз, если отстаём на чекпойнте больше чем на 2 ч:
1. Кэш тайлов в PWA → оставляем только manifest и офлайн-индикатор.
2. Английская локаль.
3. Инференс на RPi → буй только записывает, классифицирует сервер.
4. TLS на ESP32 → данные воды из симулятора.
5. Обученная голова → только маппинг AudioSet.
6. Корреляция тревог → простые правила.
7. Фактор «давление» в прогнозе.

**Не режем никогда:** безопасность из §12, честные метрики, жизненный цикл тревоги, симулятор, запуск одной командой.

## 19. Git: старт репозитория и защита `main`

- **Корневой коммит.** `main` пока не существует. Сейчас план лежит в локальной ветке `docs/phase-0-plan`. После вашего одобрения `main` создаётся из неё (fast-forward), пушится, и сразу включается ruleset. Дальше — только PR.
- **Ruleset для `main`** — применить вам или мне через `gh` после одобрения:
  - target `main`; запрет удаления и force-push;
  - PR обязателен: 1 одобрение не от автора, сброс одобрений при новых коммитах, все обсуждения закрыты;
  - обязательные проверки: `web-check`, `ml-check`, `contracts`, `audit`, `secrets`, ветка должна быть актуальна;
  - линейная история.

  Настройки репозитория: только squash merge, автоудаление веток после merge.

  Если ревьюеров-людей с доступом нет, ставим 0 одобрений. Тогда обязателен комментарий отдельного ревью-агента по критериям из `features.json`.
- **Ветки:** `<type>/<Fxx>-<тема>`, живут часы. Перед PR — rebase на `main` и повторный прогон проверок. Теги `demo-N` — только после вашего одобрения.
