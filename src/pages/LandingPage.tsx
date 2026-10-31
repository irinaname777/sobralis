import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Sobralis — публичная главная страница.
 * Фото (public/landing/): Hero.jpeg (корзина с цветами у моря), Journey.jpeg (розы в вазе).
 * Шрифты (Playfair Display + Manrope) подключает сам компонент.
 *
 * Типографика — только две роли:
 *   serif (Playfair, 500, без курсива) — логотип, заголовки, финальная фраза;
 *   sans (Manrope) — всё остальное.
 */

const C = {
  page: "#fdf2f0",
  panel: "#fbe3e1",
  panelSoft: "#fdeeec",
  rose: "#c9606f",
  ink: "#2b2224",
};
const SERIF: CSSProperties = { fontFamily: "'Playfair Display',Georgia,serif", fontWeight: 500 };
const SANS: CSSProperties = { fontFamily: "'Manrope',system-ui,-apple-system,'Segoe UI',sans-serif" };
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c9606f]";

/* Единый набор «мягких» масок: фото растворяется в фоне, без чётких контуров */
const maskStyle = (image: string, composite = false): CSSProperties =>
  ({
    WebkitMaskImage: image,
    maskImage: image,
    ...(composite ? { WebkitMaskComposite: "source-in", maskComposite: "intersect" } : {}),
  }) as CSSProperties;

const FADE_HERO_DESKTOP = maskStyle(
  "linear-gradient(to right, transparent 0%, #000 34%, #000 90%, transparent 100%), linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)",
  true,
);
const FADE_CLOSING_DESKTOP = maskStyle(
  "linear-gradient(to left, transparent 0%, #000 30%, #000 90%, transparent 100%), linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)",
  true,
);
const FADE_VERTICAL = maskStyle("linear-gradient(to bottom, transparent 0%, #000 22%, #000 74%, transparent 100%)");

const ICON: Record<string, ReactNode> = {
  group: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M3.5 19c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5M15 14.4c2.6-.4 4.7 1 5.5 4" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="3" />
      <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5M9 14h.01M12 14h.01M15 14h.01" />
    </>
  ),
  plane: <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z" />,
  wallet: (
    <>
      <path d="M5 4.5h11l3 3V19.5H5z" />
      <path d="M8.5 10.5h7M8.5 14h7M8.5 17h4" />
    </>
  ),
};

const FEATURES = [
  { n: "01", icon: "group", t: "Свои девчонки", d: "Создавайте свой круг, собирайте подруг и храните общие планы в одном уютном месте." },
  { n: "02", icon: "calendar", t: "Даты, удобные всем", d: "Сверяйте расписания и находите тот самый день, когда получится у каждой." },
  { n: "03", icon: "plane", t: "Встречи и поездки", d: "От спонтанного кофе до большого путешествия — всё начинается с общей идеи." },
  { n: "04", icon: "wallet", t: "Общие расходы", d: "Учитывайте совместные траты легко и прозрачно, без неловких напоминаний." },
];

function Heart({ className = "", opacity = 1 }: { className?: string; opacity?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} style={{ opacity }} fill="none" stroke={C.rose} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.5S4.2 15.6 3 10.6C2.3 7.5 4.4 5 7.2 5c2 0 3.6 1.2 4.8 3 1.2-1.8 2.8-3 4.8-3 2.8 0 4.9 2.5 4.2 5.6-1.2 5-9 9.9-9 9.9Z" />
    </svg>
  );
}

/** Россыпь сердечек: один крупный силуэт + два маленьких */
function Hearts({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute ${className}`}>
      <Heart className="absolute left-0 top-0 h-16 w-16 rotate-[12deg] md:h-20 md:w-20" opacity={0.85} />
      <Heart className="absolute left-[78px] top-[46px] h-6 w-6 -rotate-[14deg] md:left-[98px] md:top-[58px]" opacity={0.7} />
      <Heart className="absolute -left-5 top-[64px] h-4 w-4 rotate-[8deg]" opacity={0.55} />
    </div>
  );
}

function Wave({ fill, className = "" }: { fill: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 1440 120" preserveAspectRatio="none" className={className}>
      <path d="M0 74C230 14 480 112 760 72S1220 16 1440 64V120H0Z" fill={fill} />
    </svg>
  );
}

export default function LandingPage() {
  useEffect(() => {
    const desc =
      "Собирайте подруг, выбирайте удобные даты, планируйте встречи и поездки и делите общие расходы — легко, красиво и в одном месте.";
    document.title = "Sobralis — больше встреч, меньше суеты";
    const meta = (key: string, val: string, prop = false) => {
      const attr = prop ? "property" : "name";
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.content = val;
    };
    meta("description", desc);
    meta("og:title", "Sobralis — больше встреч, меньше суеты", true);
    meta("og:description", desc, true);
    meta("og:type", "website", true);
    meta("og:url", "https://sobralis.online/", true);
    meta("og:image", "https://sobralis.online/landing/Hero.jpeg", true);

    if (!document.getElementById("sobralis-fonts")) {
      const link = document.createElement("link");
      link.id = "sobralis-fonts";
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=Playfair+Display:wght@500&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  const hide = (e: { currentTarget: HTMLImageElement }) => (e.currentTarget.style.display = "none");

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: C.page, color: C.ink, ...SANS }}>
      {/* ───────── HERO ───────── */}
      <section className="relative">
        <div className="relative mx-auto max-w-[1440px]">
          {/* фото — десктоп */}
          <div className="absolute inset-y-0 right-0 hidden w-[58%] lg:block" style={FADE_HERO_DESKTOP} aria-hidden>
            <img
              src="/landing/Hero.jpeg"
              alt=""
              decoding="async"
              onError={hide}
              className="h-full w-full object-cover"
              style={{ objectPosition: "50% 72%" }}
            />
          </div>
          <Hearts className="right-[20%] top-[16%] hidden lg:block" />

          <header className="relative z-10 flex items-center justify-between px-6 pt-6 md:px-12 md:pt-8">
            <Link to="/" className={`text-[30px] leading-none ${FOCUS}`} style={SERIF}>
              sobralis
            </Link>
            
          </header>

          <div className="relative z-10 px-6 pt-12 md:px-12 lg:flex lg:min-h-[680px] lg:items-center lg:pb-40 lg:pt-6">
            <div className="max-w-[560px]">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/75 px-4 py-2 text-[13px] shadow-[0_8px_24px_-16px_rgba(150,60,75,.5)]">
                <Heart className="h-3.5 w-3.5" />
                Пространство для ваших общих планов
              </p>
              <h1 className="mt-7 text-[clamp(2.7rem,5vw,4.6rem)] leading-[1.06] tracking-[-0.015em]" style={SERIF}>
                Больше встреч.
                <br />
                <span style={{ color: C.rose }}>Меньше суеты.</span>
              </h1>
              <p className="mt-6 max-w-[470px] text-[16.5px] leading-[1.75] opacity-80">
                Собирайте подруг, выбирайте удобные даты, планируйте встречи и поездки и делите общие расходы — легко, красиво и в одном месте.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/signup"
                  className={`rounded-full px-8 py-4 text-center text-[15px] font-semibold text-white shadow-[0_18px_34px_-16px_rgba(201,96,111,.9)] transition hover:brightness-105 ${FOCUS}`}
                  style={{ background: C.rose }}
                >
                  Создать аккаунт
                </Link>
                <Link
                  to="/login"
                  className={`rounded-full border bg-white/60 px-8 py-4 text-center text-[15px] font-medium backdrop-blur transition hover:bg-white ${FOCUS}`}
                  style={{ borderColor: `${C.ink}26` }}
                >
                  Уже есть аккаунт
                </Link>
              </div>
              <ul className="mt-9 flex flex-wrap gap-x-8 gap-y-3 text-[13.5px]">
                {["Для подруг и близких", "Все планы вместе"].map((t) => (
                  <li key={t} className="flex items-center gap-2.5">
                    <Heart className="h-3.5 w-3.5" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* фото — мобильный/планшет */}
          <div className="relative mt-6 lg:hidden">
            <div className="aspect-[5/4] max-h-[520px] w-full sm:aspect-[16/10]" style={FADE_VERTICAL} aria-hidden>
              <img
                src="/landing/Hero.jpeg"
                alt="Корзина с нежными цветами на деревянном столе у моря"
                decoding="async"
                onError={hide}
                className="h-full w-full object-cover"
                style={{ objectPosition: "60% 70%" }}
              />
            </div>
            <Hearts className="right-[12%] top-[18%] origin-top-left scale-75" />
          </div>
        </div>
        <Wave fill={C.panel} className="absolute bottom-[-1px] left-0 z-10 h-[56px] w-full md:h-[100px]" />
      </section>

      {/* ───────── ПРЕИМУЩЕСТВА ───────── */}
      <section className="relative" style={{ background: `linear-gradient(180deg, ${C.panel} 0%, ${C.panelSoft} 100%)` }}>
        <div className="mx-auto max-w-[1280px] px-6 pb-28 pt-12 md:px-12 lg:pb-36">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:gap-16">
            <div>
              <p className="text-[12px] font-semibold tracking-[0.22em]" style={{ color: C.rose }}>
                ВСЁ В ОДНОМ МЕСТЕ
              </p>
              <h2 className="mt-4 text-[clamp(2.1rem,3.6vw,3.1rem)] leading-[1.1] tracking-[-0.01em]" style={SERIF}>
                Чтобы собраться было проще
              </h2>
            </div>
            <div>
              <p className="max-w-[440px] text-[16px] leading-[1.75] opacity-75">
                Меньше переписок и бесконечных уточнений. Больше времени на то, ради чего вы собираетесь.
              </p>
              <p className="mt-5 flex items-center gap-3 text-[14.5px]" style={{ color: C.rose }}>
                <Heart className="h-6 w-6 shrink-0" />
                Для ваших маленьких и больших поводов
              </p>
            </div>
          </div>

          <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.n} className="rounded-[28px] bg-white/60 p-7 shadow-[0_24px_50px_-36px_rgba(150,60,75,.5)] backdrop-blur">
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: C.panel }}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke={C.rose} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {ICON[f.icon]}
                    </svg>
                  </span>
                  <span className="text-[13px] tracking-widest opacity-45">{f.n}</span>
                </div>
                <h3 className="mt-6 text-[22px] leading-[1.2]" style={SERIF}>
                  {f.t}
                </h3>
                <p className="mt-3 text-[14.5px] leading-[1.7] opacity-75">{f.d}</p>
              </li>
            ))}
          </ol>
        </div>
        <Wave fill={C.page} className="absolute bottom-[-1px] left-0 h-[48px] w-full md:h-[90px]" />
      </section>

      {/* ───────── ЗАКЛЮЧИТЕЛЬНАЯ СЕКЦИЯ ───────── */}
      <section className="relative">
        <div className="relative mx-auto max-w-[1440px]">
          {/* фото — десктоп */}
          <div className="absolute inset-y-0 left-0 hidden w-[58%] lg:block" style={FADE_CLOSING_DESKTOP} aria-hidden>
            <img
              src="/landing/Journey.jpeg"
              alt=""
              loading="lazy"
              decoding="async"
              onError={hide}
              className="h-full w-full object-cover"
              style={{ objectPosition: "50% 55%" }}
            />
          </div>

          {/* фото — мобильный/планшет */}
          <div className="aspect-[4/3] max-h-[460px] w-full lg:hidden" style={FADE_VERTICAL} aria-hidden>
            <img
              src="/landing/Journey.jpeg"
              alt="Нежные розы в вазе в мягком утреннем свете"
              loading="lazy"
              decoding="async"
              onError={hide}
              className="h-full w-full object-cover"
              style={{ objectPosition: "50% 50%" }}
            />
          </div>

          <div className="relative z-10 -mt-6 px-6 pb-16 md:px-12 lg:ml-auto lg:mt-0 lg:flex lg:min-h-[560px] lg:w-[44%] lg:items-center lg:pb-0 lg:pl-0 lg:pr-16">
            <div className="relative">
              <Hearts className="-top-16 right-0 origin-top-right scale-75 lg:-top-24" />
              <p className="text-[clamp(2.4rem,4.4vw,3.6rem)] leading-[1.08] tracking-[-0.015em]" style={SERIF}>
                Время быть вместе
              </p>
              <p className="mt-3 text-[clamp(1.5rem,2.6vw,2.1rem)] leading-[1.2]" style={{ ...SERIF, color: C.rose }}>
                Остальное организуем
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── ФУТЕР ───────── */}
      <footer className="mx-auto max-w-[1280px] px-6 pb-10 md:px-12">
        <div className="flex flex-col gap-5 border-t pt-8 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: `${C.ink}1a` }}>
          <span className="text-[28px] leading-none" style={SERIF}>
            sobralis
          </span>
          <nav className="flex items-center gap-6 text-[14px]">
            <Link to="/about" className={`hover:underline ${FOCUS}`}>
              О проекте
            </Link>
            
          </nav>
        </div>
        <p className="mt-6 text-[13px] opacity-55">© 2026 Sobralis</p>
      </footer>
    </div>
  );
}
