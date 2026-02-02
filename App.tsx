import { useEffect, useMemo, useRef, useState } from "react";

type ToastType = "info" | "ok" | "warn" | "err";

type ToastItem = {
  id: string;
  type: ToastType;
  msg: string;
};

type AuthState = {
  login: string;
  display_name: string;
  access_token: string;
  obtained_at: number;
  expires_in?: number;
  implicit?: boolean;
};

type ProductOption = { label: string; price: number | null };

type Product = {
  title: string;
  badge?: string;
  note?: string;
  options: ProductOption[];
};

type OrderMsg = {
  type: "info" | "warn" | "error" | "ok";
  title: string;
  text: string;
  actions?: { label: string; onClick: () => void }[];
} | null;

// ----- Config (взято по смыслу из 1-го сайта) -----
const TELEGRAM_BOT_API_URL =
  "https://script.google.com/macros/s/AKfycbzn3wvaFYwSWkopLZP1ueRb52pJnbWM7sB2Ay4DOx3FPPvBQITpaLF-cx2hflnZ10-_Xg/exec";

const BALANCE_API_URL =
  "https://script.google.com/macros/s/AKfycbxv93RskaQaMSQ4t41bpKLhUfx1RQHiwPl-tdYicJ12lvDJ7ZCZhSCAwR2PjSYqZDo/exec";

const SPEND_ENABLED = true;
const SPEND_TOKEN = "yammy_spend_v1";

const TWITCH_CLIENT_ID = "89zu7axvj9y80avfsn6a5l20mv5kjq";

const AUTH_STORAGE_KEY = "yammy_twitch_auth_v2";

const PRODUCTS: Product[] = [
  {
    title: "🥨 Закуски (Мемы)",
    badge: "юмор",
    note: "Лёгкий контент для настроения ✨",
    options: [
      { label: "20 мемов", price: 200 },
      { label: "45 мемов", price: 400 },
    ],
  },
  {
    title: "🍿 Основное блюдо (Кино и Аниме)",
    badge: "до 2 часов",
    note: "Если зайдёт — смотрим фулл.",
    options: [
      { label: "Фильм / Мультфильм", price: 750 },
      { label: "Аниме / Сериал / Телешоу", price: 750 },
    ],
  },
  {
    title: "🌶️ На десерт (18+)",
    badge: "18+",
    note: "На твой/мой выбор.",
    options: [{ label: "Хентай аниме / Порно‑игры на Boosty", price: 1000 }],
  },
  {
    title: "🎮 Геймерская зона",
    badge: "2 часа",
    note: "❗ Для MMO — только бесплатные игры. ⚠️ Если игра не «зашла» — стоп через 2 часа.",
    options: [{ label: "Играю в ТВОЮ игру", price: 1500 }],
  },
  {
    title: "👑 Ультимативный заказ",
    badge: "марафон",
    note: "Для самых мощных заказов ✨",
    options: [{ label: "12 часов стрима", price: 5000 }],
  },
  {
    title: "🖌️ Рисунки",
    badge: "арт",
    note: "Небольшие рисунки по твоей идее ✨",
    options: [{ label: "Заказать всратыша", price: 3000 }],
  },
  {
    title: "🎁 Свой вариант",
    badge: "предложение",
    note: "Главное — чтобы было интересно и по правилам ✨",
    options: [{ label: "Хочу обсудить индивидуальный заказ", price: null }],
  },
];

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function normNick(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function parsePoints(v: unknown) {
  if (v === null || v === undefined) return Number.NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

function clampInt(n: unknown, min: number, max: number) {
  const x = Number.parseInt(String(n ?? ""), 10);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function calcPoints(N: number) {
  // Формула из 1-го сайта: S = 50×N + 0.03×(50×N)×(N-1)
  const base = 50 * N;
  const bonus = 0.03 * base * (N - 1);
  return Math.round(base + bonus);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function isProblemInAppBrowser(uaRaw: string) {
  const ua = uaRaw.toLowerCase();
  return (
    ua.includes("telegram") ||
    ua.includes("instagram") ||
    ua.includes("fbav") ||
    ua.includes("fban")
  );
}

function isTelegramInApp(uaRaw: string) {
  return uaRaw.toLowerCase().includes("telegram");
}

function isAndroid(uaRaw: string) {
  return /android/i.test(uaRaw);
}

async function withTimeout<T>(p: Promise<T>, ms = 12000) {
  return await new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("Timeout")), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function twitchGetUserHelix(accessToken: string) {
  const res = await withTimeout(
    fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-ID": TWITCH_CLIENT_ID,
      },
    }),
    12000
  );

  const txt = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(txt);
  } catch {
    // ignore
  }

  if (!res.ok) {
    const desc = json?.message || json?.error || txt.slice(0, 200);
    throw new Error(`Failed to fetch user: ${desc}`);
  }

  const u = json?.data?.[0];
  const login = String(u?.login || "").trim();
  const display = String(u?.display_name || login).trim();
  if (!login) return null;
  return { login, display_name: display, login_lower: login.toLowerCase() };
}

function parseImplicitTokenFromHash(hash: string) {
  if (!hash || !hash.includes("access_token=")) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("access_token");
  const expiresIn = params.get("expires_in");
  if (!token) return null;
  return {
    access_token: token,
    expires_in: expiresIn ? Number(expiresIn) : undefined,
  };
}

async function fetchBalances() {
  const res = await fetch(BALANCE_API_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("API request failed");
  const json: any = await res.json();
  if (!json || json.ok !== true || !Array.isArray(json.data)) {
    throw new Error("Bad API payload");
  }
  return json.data as Record<string, unknown>[];
}

async function findBalanceByNick(nick: string) {
  const needle = normNick(nick);
  if (!needle) return { found: false as const, reason: "empty" as const };

  const rows = await fetchBalances();

  const nickKeys = ["Никнейм", "никнейм", "Nick", "nick", "Ник", "ник"];
  const pointsKeys = [
    "Итоговые баллы",
    "итоговые баллы",
    "Баллы",
    "баллы",
    "Points",
    "points",
  ];

  for (const r of rows) {
    const nickVal = nickKeys.map((k) => r[k]).find((v) => v !== undefined);
    const rowNick = normNick(nickVal);
    if (!rowNick) continue;
    if (rowNick === needle) {
      const ptsVal = pointsKeys.map((k) => r[k]).find((v) => v !== undefined);
      const pts = parsePoints(ptsVal);
      return {
        found: true as const,
        nick: (nickVal ?? nick) as string,
        points: ptsVal,
        pointsNum: pts,
      };
    }
  }

  return { found: false as const, reason: "notfound" as const };
}

async function spendPoints(opts: {
  nick: string;
  amount: number;
  item: string;
  comment: string;
}) {
  const cleanNick = String(opts.nick || "").trim();
  const a = Number(opts.amount);
  if (!cleanNick) return { ok: false as const, reason: "nonick" as const };
  if (!Number.isFinite(a) || a <= 0)
    return { ok: false as const, reason: "badamount" as const };

  const payload = {
    action: "spend",
    token: SPEND_TOKEN,
    nick: cleanNick,
    amount: a,
    item: String(opts.item || "").slice(0, 200),
    comment: String(opts.comment || "").slice(0, 500),
    at: Date.now(),
  };

  const res = await fetch(BALANCE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const txt = await res.text();
  try {
    return JSON.parse(txt) as any;
  } catch {
    return { ok: false, reason: "badjson", raw: txt.slice(0, 200) };
  }
}

async function sendOrderToBot(payload: {
  nick: string;
  item: string;
  price: string;
  comment: string;
}) {
  try {
    const res = await fetch(TELEGRAM_BOT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        nick: payload.nick || "Не указан",
        item: payload.item || "Не указано",
        price: payload.price || "—",
        comment: payload.comment || "Нет",
      }),
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "Неверный формат ответа сервера", raw: text };
    }

    return data;
  } catch (e) {
    return { ok: false, error: String((e as any)?.message || e) };
  }
}

function orderTextFrom(title: string, opt: ProductOption) {
  const p = opt.price == null ? "" : ` (${opt.price} 🪙)`;
  return `${title} — ${opt.label}${p}`;
}

export function App() {
  const ua = useMemo(() => navigator.userAgent || "", []);
  const [noIo, setNoIo] = useState(false);
  const [isTg, setIsTg] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toast = (msg: string, type: ToastType = "info", ttl = 1900) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setToasts((t) => [...t, { id, type, msg }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, ttl);
  };

  const [remember, setRemember] = useState(true);
  const [auth, setAuth] = useState<AuthState | null>(null);

  const [balanceText, setBalanceText] = useState<string>("—");
  const [balanceHint, setBalanceHint] = useState<string>(
    "Нужно войти через Twitch, чтобы увидеть баланс."
  );

  const [selected, setSelected] = useState<{
    itemText: string;
    title: string;
    price: number | null;
  } | null>(null);

  const [comment, setComment] = useState<string>("");

  const [orderMsg, setOrderMsg] = useState<OrderMsg>(null);
  const [orderStage, setOrderStage] = useState<
    | { kind: "form" }
    | { kind: "processing"; text: string; hint: string }
    | { kind: "success" }
    | { kind: "error"; title: string; text: string }
  >({ kind: "form" });

  const [calcOpen, setCalcOpen] = useState(false);
  const [clips, setClips] = useState(1);

  const orderRef = useRef<HTMLDivElement | null>(null);

  // --- In-app browsers fallback (из 1-го сайта) ---
  useEffect(() => {
    try {
      const inApp = isProblemInAppBrowser(ua);
      const tg = isTelegramInApp(ua);
      setIsTg(tg);

      const missingIO = !("IntersectionObserver" in window);
      if (inApp || missingIO) {
        document.documentElement.classList.add("no-io");
        setNoIo(true);
      }
    } catch {
      document.documentElement.classList.add("no-io");
      setNoIo(true);
    }
  }, [ua]);

  // --- Reveal animation setup ---
  useEffect(() => {
    const isSmallOrTablet = window.matchMedia("(max-width: 1024px)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const all = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));

    if (noIo || isSmallOrTablet || reduced) {
      all.forEach((el) => el.classList.add("is-in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 }
    );

    all.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [noIo]);

  // --- Decorative petals (как во 2-м дизайне, но отключаем в проблемных браузерах) ---
  useEffect(() => {
    const host = document.getElementById("petals");
    if (!host) return;

    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!isDesktop || reduced || noIo) return;

    const rand = (min: number, max: number) => Math.random() * (max - min) + min;

    const createPetal = () => {
      const el = document.createElement("div");
      const size = rand(10, 18);
      const startX = rand(0, window.innerWidth);
      const drift = rand(-60, 60);
      const dur = rand(7, 12);
      const rot = rand(0, 360);
      const hue = rand(330, 360);
      const opacity = rand(0.25, 0.55);

      el.style.position = "absolute";
      el.style.left = `${startX}px`;
      el.style.top = "-30px";
      el.style.width = `${size}px`;
      el.style.height = `${size * 0.75}px`;
      el.style.borderRadius = "999px 999px 999px 0";
      el.style.transform = `rotate(${rot}deg)`;
      el.style.opacity = opacity.toFixed(2);
      el.style.background = `hsl(${hue} 85% 70% / .9)`;
      el.style.boxShadow = "0 10px 25px rgba(0,0,0,.08)";
      el.style.filter = "blur(.2px)";
      el.style.pointerEvents = "none";

      const keyframes: Keyframe[] = [
        { transform: `translate3d(0,0,0) rotate(${rot}deg)`, offset: 0 },
        {
          transform: `translate3d(${drift * 0.6}px, ${window.innerHeight * 0.45}px, 0) rotate(${rot + 160}deg)`,
          offset: 0.55,
        },
        {
          transform: `translate3d(${drift}px, ${window.innerHeight + 80}px, 0) rotate(${rot + 340}deg)`,
          offset: 1,
        },
      ];

      const anim = el.animate(keyframes, {
        duration: dur * 1000,
        easing: "linear",
        iterations: 1,
      });
      anim.onfinish = () => el.remove();
      return el;
    };

    let running = true;
    const maxOnScreen = 18;

    const tick = () => {
      if (!running) return;
      const count = host.childElementCount;
      if (count < maxOnScreen) {
        const add = Math.min(2, maxOnScreen - count);
        for (let i = 0; i < add; i++) host.appendChild(createPetal());
      }
      window.setTimeout(tick, rand(450, 900));
    };

    tick();
    const onVis = () => {
      running = !document.hidden;
      if (running) tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      document.removeEventListener("visibilitychange", onVis);
      host.innerHTML = "";
    };
  }, [noIo]);

  // --- Auth storage helpers ---
  const setAuthStored = (a: AuthState | null) => {
    setAuth(a);
    try {
      if (!a) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        sessionStorage.removeItem(AUTH_STORAGE_KEY);
        return;
      }

      if (remember) {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(a));
        sessionStorage.removeItem(AUTH_STORAGE_KEY);
      } else {
        sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(a));
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  };

  const getAuthStored = () => {
    try {
      const s = sessionStorage.getItem(AUTH_STORAGE_KEY);
      if (s) return JSON.parse(s) as AuthState;
    } catch {
      // ignore
    }
    try {
      const s = localStorage.getItem(AUTH_STORAGE_KEY);
      if (s) return JSON.parse(s) as AuthState;
    } catch {
      // ignore
    }
    return null;
  };

  // --- OAuth callback + restore ---
  useEffect(() => {
    const init = async () => {
      // restore remember flag based on where token exists
      setRemember(!!localStorage.getItem(AUTH_STORAGE_KEY));

      const implicit = parseImplicitTokenFromHash(window.location.hash || "");
      if (implicit?.access_token) {
        try {
          // clean hash
          try {
            history.replaceState({}, document.title, window.location.pathname + window.location.search);
          } catch {
            // ignore
          }

          toast("Получаем профиль Twitch…", "info", 1200);
          const user = await twitchGetUserHelix(implicit.access_token);
          if (!user?.login) throw new Error("No login");

          const a: AuthState = {
            login: user.login,
            display_name: user.display_name,
            access_token: implicit.access_token,
            obtained_at: Date.now(),
            expires_in: implicit.expires_in,
            implicit: true,
          };
          setAuthStored(a);
          toast("Вход выполнен", "ok");
          await refreshBalance(a);
          return;
        } catch (e) {
          setAuthStored(null);
          setBalanceText("—");
          setBalanceHint(`Не удалось войти через Twitch. ${String((e as any)?.message || e)}`);
          toast("Не удалось авторизоваться", "err", 2400);
          return;
        }
      }

      const a = getAuthStored();
      if (a?.login) {
        setAuth(a);
        // try to refresh display_name if not present
        if (a.access_token && !a.display_name) {
          try {
            const user = await twitchGetUserHelix(a.access_token);
            if (user?.display_name) {
              const aa: AuthState = { ...a, display_name: user.display_name };
              setAuthStored(aa);
            }
          } catch {
            // ignore
          }
        }
        // refresh balance lazy
        window.setTimeout(() => {
          void refreshBalance(a);
        }, 250);
      } else {
        setAuth(null);
      }
    };

    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginTwitch = async () => {
    setOrderMsg(null);

    // Telegram in-app: предупреждение + копирование ссылки (как в 1-м сайте)
    if (isTelegramInApp(ua)) {
      setOrderMsg({
        type: "info",
        title: "Авторизация в Telegram",
        text: "Встроенный браузер Telegram может блокировать авторизацию. Открой сайт в Chrome/Safari.",
        actions: [
          {
            label: "Скопировать ссылку на сайт",
            onClick: async () => {
              const ok = await copyText(window.location.href);
              if (ok) {
                toast("Ссылка скопирована", "ok");
              } else {
                toast("Не удалось скопировать", "err");
              }
            },
          },
        ],
      });
      return;
    }

    const redirectUri = window.location.origin + window.location.pathname;

    const state = `implicit_${Math.random().toString(16).slice(2)}${Date.now()}`;
    const params = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "token",
      scope: "",
      state,
    });

    const authUrl = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;

    if (isAndroid(ua)) {
      // Android: пытаемся открыть во внешнем браузере через intent
      const intentUrl =
        `intent://id.twitch.tv/oauth2/authorize?${params.toString()}` +
        `#Intent;scheme=https;action=android.intent.action.VIEW;` +
        `S.browser_fallback_url=${encodeURIComponent(authUrl)};end;;`;

      window.location.href = intentUrl;
      window.setTimeout(() => {
        window.location.href = authUrl;
      }, 500);
      return;
    }

    window.location.assign(authUrl);
  };

  const logoutTwitch = () => {
    setAuthStored(null);
    setBalanceText("—");
    setBalanceHint("Нужно войти через Twitch, чтобы увидеть баланс.");
    toast("Вы вышли", "ok");
  };

  const refreshBalance = async (forcedAuth?: AuthState | null) => {
    const a = forcedAuth ?? auth;

    if (!a?.login) {
      setBalanceText("—");
      setBalanceHint("Нужно войти через Twitch, чтобы увидеть баланс.");
      return;
    }

    setBalanceText("Загружаю…");
    setBalanceHint("Данные подтягиваются из Google Таблицы.");

    try {
      const res = await findBalanceByNick(a.login);
      if (res.found) {
        const pts = Number.isFinite(res.pointsNum)
          ? Math.round(res.pointsNum)
          : Number.parseInt(String(res.points ?? "0"), 10) || 0;
        setBalanceText(`${a.display_name || a.login} — ${pts} 🪙`);
        setBalanceHint("Если баллы не совпадают — проверь обновление таблицы.");
      } else {
        setBalanceText(`${a.display_name || a.login} — 0 🪙 😢`);
        setBalanceHint("У вас 0 баллов 😢");
      }
    } catch {
      setBalanceText("Ошибка загрузки.");
      setBalanceHint(
        "Проверь доступ Apps Script (Deploy → Web app → доступ: \"Все\")."
      );
    }
  };

  const selectProduct = (product: Product, opt: ProductOption) => {
    const itemText = orderTextFrom(product.title, opt);
    setSelected({ itemText, title: `${product.title} — ${opt.label}`, price: opt.price });
    toast("Товар выбран", "ok", 1200);
    window.setTimeout(() => {
      orderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const resetOrder = () => {
    setOrderMsg(null);
    setOrderStage({ kind: "form" });
    setComment("");
    setSelected(null);
  };

  const placeOrder = async () => {
    setOrderMsg(null);

    if (!auth?.login) {
      setOrderMsg({
        type: "warn",
        title: "Нужно авторизоваться на Twitch",
        text: "Чтобы оформить заказ, сначала войди через Twitch в блоке «Баланс».",
        actions: [{ label: "Войти через Twitch", onClick: () => void loginTwitch() }],
      });
      return;
    }

    if (!selected?.itemText) {
      setOrderMsg({
        type: "warn",
        title: "Выбери товар",
        text: "Сначала выбери награду в разделе «Товары».",
      });
      return;
    }

    const spend = selected.price;

    setOrderStage({
      kind: "processing",
      text: "⏳ Обрабатываем заказ…",
      hint: "Проверяем баланс и отправляем в Telegram",
    });

    try {
      if (SPEND_ENABLED && typeof spend === "number" && spend > 0) {
        setOrderStage({
          kind: "processing",
          text: "💰 Проверяем баланс…",
          hint: "Убеждаемся, что хватает баллов",
        });

        const res = await findBalanceByNick(auth.login);
        if (!res.found) {
          setOrderStage({
            kind: "error",
            title: "У вас 0 баллов 😢",
            text: "Похоже, тебя нет в таблице. Напиши Ями, чтобы тебя добавили.",
          });
          return;
        }

        const currentBalance = Number.isFinite(res.pointsNum)
          ? Math.round(res.pointsNum)
          : 0;

        if (currentBalance < spend) {
          setOrderStage({
            kind: "error",
            title: "Недостаточно баллов 😢",
            text: `Для этого заказа нужно ${spend} 🪙, а у тебя ${currentBalance} 🪙.`,
          });
          return;
        }
      }

      setOrderStage({
        kind: "processing",
        text: "📨 Отправляем в Telegram…",
        hint: "Ваш заказ отправляется Ями",
      });

      const priceText =
        typeof spend === "number" && spend > 0 ? `${spend} 🪙` : "—";

      const result = await sendOrderToBot({
        nick: auth.display_name || auth.login,
        item: selected.itemText,
        price: priceText,
        comment: comment.trim() || "Нет",
      });

      if (!result?.ok) {
        setOrderStage({
          kind: "error",
          title: "Ошибка отправки",
          text: "Не удалось отправить заказ. Попробуй ещё раз или напиши Ями напрямую в Telegram: @YammyTanuki",
        });
        return;
      }

      if (SPEND_ENABLED && typeof spend === "number" && spend > 0) {
        setOrderStage({
          kind: "processing",
          text: "💰 Списываем баллы…",
          hint: "Обновляем ваш баланс",
        });

        const spendRes = await spendPoints({
          nick: auth.login,
          amount: spend,
          item: selected.itemText,
          comment: comment.trim(),
        });

        if (spendRes?.ok) {
          await refreshBalance(auth);
        }
      }

      setOrderStage({ kind: "success" });
      toast("Заказ отправлен", "ok");
    } catch (e) {
      setOrderStage({
        kind: "error",
        title: "Ошибка связи",
        text: "Не удалось связаться с сервером. Попробуй ещё раз.",
      });
      console.error(e);
    }
  };

  const selectedLabel = selected?.title ?? "не выбран";
  const orderCost = selected?.price == null ? "—" : `${selected.price} 🪙`;

  return (
    <div className="text-slate-900">
      <div id="petals" aria-hidden="true" />

      {/* Background floaties */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div
          className="hidden lg:block"
          style={{
            position: "absolute",
            top: "10%",
            left: "8%",
            width: 220,
            height: 220,
            borderRadius: 9999,
            filter: "blur(22px)",
            opacity: 0.35,
            background: "rgba(100,200,255,.25)",
            boxShadow: "0 0 80px rgba(100,200,255,.2)",
          }}
        />
        <div
          className="hidden lg:block"
          style={{
            position: "absolute",
            top: "18%",
            right: "10%",
            width: 260,
            height: 260,
            borderRadius: 9999,
            filter: "blur(22px)",
            opacity: 0.35,
            background: "rgba(120,180,255,.20)",
            boxShadow: "0 0 100px rgba(120,180,255,.15)",
          }}
        />
        <div
          className="hidden lg:block"
          style={{
            position: "absolute",
            bottom: "12%",
            left: "18%",
            width: 300,
            height: 300,
            borderRadius: 9999,
            filter: "blur(22px)",
            opacity: 0.35,
            background: "rgba(100,220,255,.15)",
            boxShadow: "0 0 120px rgba(100,220,255,.1)",
          }}
        />
      </div>

      <div id="top" className="absolute top-0 left-0 h-px w-px" />

      {isTg && (
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <div className="glass rounded-2xl border border-amber-200/60 bg-amber-50/60 p-4">
            <div className="flex items-start gap-3">
              <div className="text-xl">⚠️</div>
              <div className="text-sm text-slate-800">
                Похоже, ты открыл(а) сайт во встроенном браузере Telegram.
                Авторизация Twitch и копирование могут работать нестабильно.
                Лучше открыть в обычном браузере (Chrome/Safari).
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-16 pt-6 md:pt-10">
        {/* Hero */}
        <section className="reveal">
          <div className="glass glow rounded-3xl p-6 md:p-8">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              ✨ Добро пожаловать в магазинчик ✨
            </h1>
            <p className="mt-3 leading-relaxed text-slate-700">
              Здесь ты можешь заказать контент за баллы, которые заработал(а) на
              клипах.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="glass rounded-2xl border border-white/60 p-4">
                <div className="mb-2 text-2xl">🎬</div>
                <div className="text-sm text-slate-600">Создавай клипы</div>
                <div className="font-semibold">+50 баллов за клип</div>
              </div>
              <div className="glass rounded-2xl border border-white/60 p-4">
                <div className="mb-2 text-2xl">🛒</div>
                <div className="text-sm text-slate-600">Выбирай награды</div>
                <div className="font-semibold">Мемы, кино, игры</div>
              </div>
              <div className="glass rounded-2xl border border-white/60 p-4">
                <div className="mb-2 text-2xl">📩</div>
                <div className="text-sm text-slate-600">Заказывай</div>
                <div className="font-semibold">Прямо с сайта</div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <a
                href="#products"
                className="rounded-xl border border-white/70 bg-white/75 px-4 py-2 font-medium transition hover:bg-white"
              >
                Выбрать товар
              </a>
              <a
                href="#rules"
                className="glass rounded-xl border border-white/60 px-4 py-2 font-medium transition hover:bg-white/60"
              >
                Правила и калькулятор
              </a>
            </div>
          </div>
        </section>

        {/* Rules + Balance */}
        <section id="rules" className="mt-8 md:mt-10">
          <div className="glass glow reveal rounded-3xl p-6 md:p-8">
            <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
              <div>
                <h2 className="text-xl font-bold md:text-2xl">
                  📌 ПРАВИЛА НАЧИСЛЕНИЯ БАЛЛОВ
                </h2>
                <p className="mt-2 text-slate-600">
                  Баллы начисляются за клипы. Ниже — правила, калькулятор и
                  витрина товаров.
                </p>

                <div className="mt-4 space-y-2 leading-relaxed text-slate-800">
                  <p>
                    🎬 За каждый клип → <b>+50 баллов</b>.
                  </p>
                  <p>
                    ✨ Если клипов больше одного → к каждому следующему добавляем
                    <b> +3%</b> от суммы предыдущего клипа.
                  </p>

                  <div className="glass mt-3 rounded-2xl border border-white/60 p-4">
                    <div className="mb-2 font-semibold">Примеры:</div>
                    <ul className="space-y-1 text-sm text-slate-700">
                      <li>1 клип = 50 🪙</li>
                      <li>2 клипа = 100 + 3% × 100 × 1 = 103 🪙</li>
                      <li>3 клипа = 150 + 3% × 150 × 2 = 159 🪙</li>
                      <li>4 клипа = 200 + 3% × 200 × 3 = 218 🪙</li>
                    </ul>
                  </div>

                  <p className="mt-3">
                    ⚠️ Важно: если клип не о чем — баллы не начисляются!
                  </p>
                  <p>💡 Совет: Чем больше клипов в стриме — тем выгоднее!</p>

                  <div className="glass mt-4 rounded-2xl border border-white/60 p-4">
                    <p className="text-slate-800">
                      🎮 Проверить свои баллы вы можете на твиче, написав в чат
                      <b> !Баланс</b>
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    onClick={() => setCalcOpen(true)}
                    className="rounded-xl border border-white/70 bg-white/75 px-4 py-2 font-medium transition hover:bg-white"
                  >
                    Открыть калькулятор баллов
                  </button>

                  <button
                    onClick={async () => {
                      const ok = await copyText("!Баланс");
                      toast(ok ? "Скопировано" : "Не удалось скопировать", ok ? "ok" : "err");
                    }}
                    className="glass rounded-xl border border-white/60 px-4 py-2 font-medium transition hover:bg-white/60"
                  >
                    Скопировать команду !Баланс
                  </button>
                </div>
              </div>

              <aside className="glass glow rounded-3xl border border-white/60 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold">Баланс</h3>
                </div>

                <div className="glass mb-3 rounded-2xl border border-white/60 p-4">
                  <div className="text-xs text-slate-600">Статус</div>
                  <div className="font-semibold truncate">
                    {auth?.login ? "Авторизован(а)" : "Не авторизован(а)"}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {auth?.login
                      ? "Можно обновлять баланс и оформлять заказ."
                      : "Войди через Twitch, чтобы проверять баланс и оформлять заказ."}
                  </div>
                </div>

                {!auth?.login ? (
                  <div className="mb-3">
                    <button
                      onClick={() => void loginTwitch()}
                      className="glass w-full rounded-xl border border-white/60 px-4 py-2 font-medium transition hover:bg-white/60"
                    >
                      Войти через Twitch
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="glass rounded-2xl border border-white/60 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs text-slate-600">Ник (Twitch)</div>
                          <div className="truncate font-semibold">
                            {auth.display_name || auth.login}
                          </div>
                        </div>
                        <button
                          onClick={logoutTwitch}
                          className="rounded-lg border border-white/60 bg-white/70 px-2 py-1 text-xs font-medium transition hover:bg-white/90"
                        >
                          Выход
                        </button>
                      </div>
                    </div>

                    <div className="glass rounded-2xl border border-white/60 p-4">
                      <div className="text-xs text-slate-600">Баллы</div>
                      <div className="text-2xl font-extrabold tracking-tight">
                        {balanceText}
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        {balanceHint}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void refreshBalance()}
                        className="flex-1 rounded-xl border border-white/70 bg-white/75 px-4 py-2 font-medium transition hover:bg-white"
                      >
                        Обновить
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await copyText("!Баланс");
                          toast(ok ? "Скопировано" : "Не удалось скопировать", ok ? "ok" : "err");
                        }}
                        className="glass flex-1 rounded-xl border border-white/60 px-4 py-2 font-medium transition hover:bg-white/60"
                      >
                        Скопировать !Баланс
                      </button>
                    </div>

                    <label className="mt-1 flex select-none items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setRemember(v);
                          // перенесём сохранённый auth между storage
                          if (!auth) return;
                          try {
                            if (v) {
                              localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
                              sessionStorage.removeItem(AUTH_STORAGE_KEY);
                            } else {
                              sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
                              localStorage.removeItem(AUTH_STORAGE_KEY);
                            }
                          } catch {
                            // ignore
                          }
                        }}
                      />
                      Запомнить вход на этом устройстве
                    </label>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </section>

        {/* Products */}
        <section id="products" className="mt-8 md:mt-10">
          <div className="glass glow reveal rounded-3xl p-6 md:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold md:text-2xl">🛍️ Товары</h2>
                <p className="mt-2 text-sm text-slate-700">
                  Выбирай награду — и сайт прокрутит к оформлению заказа.
                </p>
              </div>
              <div className="text-sm text-slate-600">
                Выбранный товар: {" "}
                <span className="font-semibold text-slate-900">{selectedLabel}</span>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {PRODUCTS.map((p) => (
                <div
                  key={p.title}
                  className="glass reveal rounded-3xl border border-white/60 p-5 transition hover:bg-white/60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-600">{p.badge || ""}</div>
                      <div className="text-lg font-bold">{p.title}</div>
                    </div>
                    <div className="text-xs text-slate-600">{p.note || ""}</div>
                  </div>

                  <div
                    className={cn(
                      "mt-4 grid gap-3",
                      p.options.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"
                    )}
                  >
                    {p.options.map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => selectProduct(p, opt)}
                        className="glass rounded-2xl border border-white/60 p-4 text-left transition hover:bg-white/70"
                      >
                        <div className="text-sm text-slate-600">
                          {opt.price == null ? "—" : `${opt.price} 🪙`}
                        </div>
                        <div className="font-semibold">{opt.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How to + Order */}
        <section id="howto" className="mt-8 grid gap-6 md:mt-10 lg:grid-cols-2 lg:items-start">
          <div className="glass glow reveal rounded-3xl p-6 md:p-8">
            <h2 className="text-xl font-bold md:text-2xl">Как оформить заказ?</h2>
            <p className="mt-3 leading-relaxed text-slate-700">
              Напиши мне в ЛС в Telegram — одним кликом из этого сайта.
            </p>
            <ol className="mt-4 space-y-2 text-slate-800">
              <li>1) Выбери награду в разделе «Товары».</li>
              <li>2) Добавь комментарий (если нужно) и нажми «Заказать».</li>
              <li>3) Я получу заказ в Telegram и отвечу тебе.</li>
            </ol>
          </div>

          <div ref={orderRef} id="order" className="glass glow reveal rounded-3xl p-6 md:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold">Оформление заказа</h3>
                <p className="mt-1 text-sm text-slate-700">
                  Выбери товар, проверь баланс и отправь заказ.
                </p>
              </div>
              <div className="text-right text-sm">
                <div className="text-slate-600">Стоимость</div>
                <div className="text-2xl font-extrabold">{orderCost}</div>
              </div>
            </div>

            {orderMsg && (
              <div
                className={cn(
                  "mt-4 rounded-2xl border p-4 text-sm",
                  "glass",
                  orderMsg.type === "ok" && "bg-emerald-50/70 border-emerald-200/70 text-emerald-800",
                  orderMsg.type === "warn" && "bg-amber-50/70 border-amber-200/70 text-amber-900",
                  orderMsg.type === "error" && "bg-rose-50/70 border-rose-200/70 text-rose-800",
                  orderMsg.type === "info" && "bg-white/70 border-white/60 text-slate-800"
                )}
              >
                <div className="font-semibold">{orderMsg.title}</div>
                <div className="mt-1 whitespace-pre-line">{orderMsg.text}</div>
                {orderMsg.actions && orderMsg.actions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {orderMsg.actions.map((a) => (
                      <button
                        key={a.label}
                        onClick={a.onClick}
                        className="glass rounded-xl border border-white/60 px-3 py-2 text-xs font-semibold transition hover:bg-white/60"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {orderStage.kind === "form" && (
              <div className="mt-5 space-y-3">
                <div className="glass rounded-2xl border border-white/60 p-4">
                  <div className="text-xs text-slate-600">Товар</div>
                  <div className="mt-1 font-semibold">
                    {selected?.itemText ?? "Не выбран"}
                  </div>
                </div>

                <div>
                  <label htmlFor="comment" className="text-xs text-slate-600">
                    Комментарий (опционально)
                  </label>
                  <textarea
                    id="comment"
                    rows={4}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="glass mt-1 w-full rounded-2xl border border-white/60 p-4 outline-none focus:ring-2 focus:ring-white/60"
                    placeholder="Например: какой фильм / какая игра / любые пожелания"
                  />
                </div>

                <button
                  onClick={() => void placeOrder()}
                  className="w-full rounded-2xl border border-white/70 bg-white/80 px-5 py-3 font-semibold transition hover:bg-white"
                >
                  Заказать
                </button>
              </div>
            )}

            {orderStage.kind === "processing" && (
              <div className="mt-5 glass rounded-2xl border border-white/60 p-4">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-900/25 border-t-slate-900" />
                  <div className="text-sm text-slate-800">{orderStage.text}</div>
                </div>
                <div className="mt-1 text-xs text-slate-600">{orderStage.hint}</div>
              </div>
            )}

            {orderStage.kind === "success" && (
              <div className="mt-5">
                <div className="glass rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-4 text-emerald-800">
                  <div className="text-sm font-semibold">✅ Заказ успешно отправлен!</div>
                  <div className="mt-1 text-xs">Ями получил твой заказ.</div>
                </div>

                <button
                  onClick={resetOrder}
                  className="glass mt-3 w-full rounded-2xl border border-white/60 px-5 py-3 font-semibold transition hover:bg-white/60"
                >
                  Оформить ещё один заказ
                </button>
              </div>
            )}

            {orderStage.kind === "error" && (
              <div className="mt-5">
                <div className="glass rounded-2xl border border-rose-200/70 bg-rose-50/70 p-4 text-rose-800">
                  <div className="text-sm font-semibold">❌ {orderStage.title}</div>
                  <div className="mt-1 text-xs">{orderStage.text}</div>
                </div>

                <button
                  onClick={() => setOrderStage({ kind: "form" })}
                  className="glass mt-3 w-full rounded-2xl border border-white/60 px-5 py-3 font-semibold transition hover:bg-white/60"
                >
                  Попробовать снова
                </button>
              </div>
            )}
          </div>
        </section>

        <footer className="mt-10">
          <div className="glass glow reveal rounded-3xl p-6 text-sm text-slate-700 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                Сделано в стиле: стекло, свет, градиенты — и рабочая авторизация.
              </div>
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="glass rounded-xl border border-white/60 px-4 py-2 font-medium transition hover:bg-white/60"
              >
                Наверх
              </button>
            </div>
          </div>
        </footer>
      </main>

      {/* Calculator modal */}
      {!calcOpen ? null : (
        <div className="fixed inset-0 z-50">
          <div
            className="modal-backdrop absolute inset-0"
            onClick={() => setCalcOpen(false)}
          />
          <div className="relative mx-auto max-w-lg px-4 py-8">
            <div className="glass glow rounded-3xl border border-white/60 p-6 md:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-bold">Калькулятор баллов</div>
                  <div className="mt-1 text-sm text-slate-700">
                    Считает по формуле: S = 50×N + 0.03×(50×N)×(N-1)
                  </div>
                </div>
                <button
                  onClick={() => setCalcOpen(false)}
                  className="glass rounded-xl border border-white/60 px-3 py-2 transition hover:bg-white/60"
                >
                  Закрыть
                </button>
              </div>

              <div className="mt-5 grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <button
                  onClick={() => setClips((v) => Math.max(0, v - 1))}
                  className="glass h-12 w-12 rounded-2xl border border-white/60 text-xl transition hover:bg-white/60"
                >
                  −
                </button>
                <input
                  value={clips}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  onChange={(e) => setClips(clampInt(e.target.value, 0, 9999))}
                  className="glass h-12 w-full rounded-2xl border border-white/60 px-4 text-center text-lg font-semibold outline-none focus:ring-2 focus:ring-white/60"
                />
                <button
                  onClick={() => setClips((v) => Math.min(9999, v + 1))}
                  className="glass h-12 w-12 rounded-2xl border border-white/60 text-xl transition hover:bg-white/60"
                >
                  +
                </button>
              </div>

              <div className="glass mt-4 rounded-2xl border border-white/60 p-4">
                <div className="text-xs text-slate-600">Результат</div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="text-3xl font-extrabold">{calcPoints(Math.max(1, clips))}</div>
                  <button
                    onClick={async () => {
                      const ok = await copyText(String(calcPoints(Math.max(1, clips))));
                      toast(ok ? "Скопировано" : "Не удалось скопировать", ok ? "ok" : "err");
                    }}
                    className="rounded-xl border border-white/70 bg-white/75 px-4 py-2 font-medium transition hover:bg-white"
                  >
                    Копировать
                  </button>
                </div>
                <div className="mt-1 text-xs text-slate-600">Закрытие: ESC</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ESC close */}
      <EscClose open={calcOpen} onClose={() => setCalcOpen(false)} />

      {/* Toasts */}
      <div className="fixed bottom-4 left-0 right-0 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "glass max-w-[92vw] rounded-2xl border px-4 py-3 text-sm shadow-[0_18px_55px_rgba(18,28,55,.14)]",
              "toast",
              t.type === "ok" && "bg-emerald-50/70 text-emerald-800 border-emerald-200/60",
              t.type === "warn" && "bg-amber-50/70 text-amber-900 border-amber-200/70",
              t.type === "err" && "bg-rose-50/70 text-rose-800 border-rose-200/70",
              t.type === "info" && "bg-white/70 text-slate-900 border-white/60"
            )}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function EscClose({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return null;
}
