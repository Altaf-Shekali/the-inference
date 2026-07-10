import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  Img,
  Audio,
  staticFile,
} from "remotion";
import { z } from "zod";
import { loadFont as loadKannada } from "@remotion/google-fonts/NotoSansKannada";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";

const { fontFamily: kn } = loadKannada();
const { fontFamily: pop } = loadPoppins();

const BRAND = "#1565C0";
const BRAND_DEEP = "#0D47A1";
const BRAND_LIGHT = "#42A5F5";
const WHITE = "#FFFFFF";

export const kavalPromoSchema = z.object({
  appNameKn: z.string(),
  appNameEn: z.string(),
  tagline: z.string(),
  cta: z.string(),
  music: z.string(), // file in public/ (e.g. "music.mp3"); "" = no audio
});
export type KavalPromoProps = z.infer<typeof kavalPromoSchema>;

type Screen = { src: string; kn: string; en: string };

type Config = {
  screens: Screen[];
  screenDur: number;
  introMode: "full" | "compact";
  introLen: number; // frames the brand intro sequence occupies (incl. fade)
};

const ALL_SCREENS: Record<string, Screen> = {
  home: { src: "home", kn: "ಸುರಕ್ಷತಾ ಸ್ಕೋರ್", en: "Your phone's security score" },
  scan: { src: "scan", kn: "ಫೋನ್ ಸ್ಕ್ಯಾನ್", en: "Find risky apps — 112 checked" },
  breach: { src: "breach", kn: "ಇಮೇಲ್ ಸೋರಿಕೆ ಪರಿಶೀಲನೆ", en: "Has your email leaked?" },
  password: { src: "password", kn: "ಪಾಸ್‌ವರ್ಡ್ ಸಾಧನಗಳು", en: "Strong passwords + leak check" },
  link: { src: "link", kn: "ಲಿಂಕ್ ಸುರಕ್ಷತೆ", en: "Is this link safe?" },
  learn: { src: "learn", kn: "ಸ್ಕ್ಯಾಮ್ ಅಕಾಡೆಮಿ", en: "Learn to spot scams" },
};

const pick = (...keys: string[]) => keys.map((k) => ALL_SCREENS[k]);

export const FULL: Config = {
  screens: pick("home", "scan", "breach", "password", "link", "learn"),
  screenDur: 50,
  introMode: "full",
  introLen: 115,
};
export const SHORT: Config = {
  screens: pick("home", "scan", "breach", "link"),
  screenDur: 40,
  introMode: "compact",
  introLen: 55,
};
export const WIDE: Config = {
  screens: pick("home", "scan", "breach", "password", "link", "learn"),
  screenDur: 55,
  introMode: "full",
  introLen: 115,
};

// ---------- shared bits ----------

const Shield: React.FC<{
  size?: number;
  bodyOpacity?: number;
  checkDraw?: number;
}> = ({ size = 420, bodyOpacity = 1, checkDraw = 1 }) => (
  <svg
    width={size}
    height={size * (500 / 420)}
    viewBox="0 0 100 120"
    style={{ filter: "drop-shadow(0 18px 44px rgba(0,0,0,0.35))" }}
  >
    <path
      d="M50 4 L92 19 L92 60 C92 92 73 110 50 118 C27 110 8 92 8 60 L8 19 Z"
      fill={WHITE}
      opacity={bodyOpacity}
    />
    <polyline
      points="33,62 45,76 70,42"
      fill="none"
      stroke={BRAND}
      strokeWidth={9}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - checkDraw}
    />
  </svg>
);

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const bgScale = interpolate(frame, [0, durationInFrames], [1.08, 1.18]);
  return (
    <>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 34%, ${BRAND_LIGHT} 0%, ${BRAND} 44%, ${BRAND_DEEP} 100%)`,
        }}
      />
      <AbsoluteFill style={{ transform: `scale(${bgScale})` }}>
        <div
          style={{
            position: "absolute",
            top: "8%",
            left: "6%",
            width: 560,
            height: 560,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.10)",
            filter: "blur(95px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "6%",
            right: "4%",
            width: 680,
            height: 680,
            borderRadius: "50%",
            background: "rgba(13,71,161,0.5)",
            filter: "blur(105px)",
          }}
        />
      </AbsoluteFill>
    </>
  );
};

// ---------- scene 1: brand intro ----------

const BrandIntro: React.FC<KavalPromoProps & { config: Config }> = ({
  appNameKn,
  appNameEn,
  tagline,
  config,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height >= width;

  const compact = config.introMode === "compact";
  const kf = compact
    ? { body: [2, 12], check: [10, 24], liftAt: [24, 38], wordFrom: 20, out: [config.introLen - 12, config.introLen] }
    : { body: [4, 20], check: [22, 42], liftAt: [48, 72], wordFrom: 50, out: [95, 115] };

  const shieldSpring = spring({ frame, fps, config: { damping: 12, stiffness: 90 } });
  const shieldScale = interpolate(shieldSpring, [0, 1], [0.4, 1]);
  const bodyOpacity = interpolate(frame, kf.body, [0, 1], { extrapolateRight: "clamp" });
  const checkDraw = interpolate(frame, kf.check, [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lift = interpolate(frame, kf.liftAt, [0, portrait ? -300 : -230], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const wordSpring = spring({ frame: frame - kf.wordFrom, fps, config: { damping: 14 } });
  const wordOpacity = interpolate(wordSpring, [0, 1], [0, 1]);
  const wordY = interpolate(wordSpring, [0, 1], [40, 0]);

  const sceneOut = interpolate(frame, kf.out, [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const shieldSize = portrait ? 420 : 330;
  const knSize = portrait ? 150 : 120;
  const enSize = portrait ? 56 : 46;
  const tagSize = portrait ? 46 : 38;
  const wordShift = portrait ? 180 : 150;

  return (
    <AbsoluteFill style={{ opacity: sceneOut }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateY(${lift}px) scale(${shieldScale})` }}>
          <Shield size={shieldSize} bodyOpacity={bodyOpacity} checkDraw={checkDraw} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `translateY(${wordShift}px)`,
        }}
      >
        <div style={{ opacity: wordOpacity, transform: `translateY(${wordY}px)`, textAlign: "center" }}>
          <div style={{ fontFamily: kn, fontSize: knSize, fontWeight: 700, color: WHITE, lineHeight: 1 }}>
            {appNameKn}
          </div>
          <div
            style={{
              fontFamily: pop,
              fontSize: enSize,
              fontWeight: 600,
              color: "rgba(255,255,255,0.85)",
              letterSpacing: 14,
              marginTop: 8,
              textTransform: "uppercase",
            }}
          >
            {appNameEn}
          </div>
          <div style={{ fontFamily: kn, fontSize: tagSize, fontWeight: 500, color: "rgba(255,255,255,0.9)", marginTop: 24 }}>
            {tagline}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- scene 2: phone showcase ----------

const Caption: React.FC<{ s: Screen; align: "center" | "left"; size: number }> = ({ s, align, size }) => (
  <>
    <div style={{ fontFamily: kn, fontSize: size, fontWeight: 700, color: WHITE, textAlign: align }}>{s.kn}</div>
    <div
      style={{
        fontFamily: pop,
        fontSize: size * 0.5,
        fontWeight: 500,
        color: "rgba(255,255,255,0.85)",
        marginTop: 8,
        textAlign: align,
      }}
    >
      {s.en}
    </div>
  </>
);

const PhoneShowcase: React.FC<KavalPromoProps & { config: Config }> = ({ appNameEn, config }) => {
  const frame = useCurrentFrame(); // local to this Sequence
  const { fps, width, height } = useVideoConfig();
  const portrait = height >= width;

  const PHONE_W = portrait ? 440 : 360;
  const PHONE_H = Math.round(PHONE_W * (1600 / 720));
  const BEZEL = portrait ? 14 : 12;

  const { screens, screenDur } = config;

  const head = spring({ frame, fps, config: { damping: 16 } });
  const headOpacity = interpolate(head, [0, 1], [0, 1]);
  const headY = interpolate(head, [0, 1], [-30, 0]);

  const phoneSpring = spring({ frame, fps, config: { damping: 15 } });
  const phoneShift = interpolate(phoneSpring, [0, 1], [120, 0]);
  const phoneOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });

  const activeIndex = Math.min(screens.length - 1, Math.floor(frame / screenDur));

  const phoneEl = (
    <div
      style={{
        transform: portrait ? `translateY(${phoneShift}px)` : `translateX(${-phoneShift}px)`,
        width: PHONE_W + BEZEL * 2,
        height: PHONE_H + BEZEL * 2,
        background: "#0A0A0A",
        borderRadius: portrait ? 54 : 46,
        padding: BEZEL,
        boxShadow: "0 40px 90px rgba(0,0,0,0.45), 0 0 0 2px rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: PHONE_W,
          height: PHONE_H,
          borderRadius: portrait ? 42 : 36,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        {screens.map((s, i) => {
          const start = i * screenDur;
          const end = start + screenDur;
          const appear = interpolate(frame, [start, start + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const disappear =
            i === screens.length - 1
              ? 1
              : interpolate(frame, [end - 10, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const op = appear * disappear;
          const tx =
            interpolate(frame, [start, start + 12], [70, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) +
            (i === screens.length - 1
              ? 0
              : interpolate(frame, [end - 12, end], [0, -70], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
          if (op <= 0 && i !== activeIndex) return null;
          return (
            <Img
              key={s.src}
              src={staticFile(`screens/${s.src}.jpeg`)}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: op,
                transform: `translateX(${tx}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );

  const dots = (
    <div style={{ display: "flex", gap: 14 }}>
      {screens.map((s, i) => (
        <div
          key={s.src}
          style={{
            width: i === activeIndex ? 34 : 12,
            height: 12,
            borderRadius: 999,
            background: i === activeIndex ? WHITE : "rgba(255,255,255,0.4)",
          }}
        />
      ))}
    </div>
  );

  const captionStack = screens.map((s, i) => {
    const start = i * screenDur;
    const end = start + screenDur;
    const op =
      interpolate(frame, [start, start + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) *
      (i === screens.length - 1
        ? 1
        : interpolate(frame, [end - 8, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    const ty = interpolate(frame, [start, start + 10], [18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return { s, op, ty, key: s.src };
  });

  if (portrait) {
    return (
      <AbsoluteFill style={{ opacity: phoneOpacity }}>
        {/* header */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 110 }}>
          <div style={{ opacity: headOpacity, transform: `translateY(${headY}px)`, display: "flex", alignItems: "center", gap: 18 }}>
            <Shield size={70} />
            <span style={{ fontFamily: pop, fontSize: 60, fontWeight: 700, color: WHITE, letterSpacing: 2 }}>{appNameEn}</span>
          </div>
        </AbsoluteFill>
        {/* captions */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 250 }}>
          {captionStack.map(({ s, op, ty, key }) => (
            <div key={key} style={{ position: "absolute", opacity: op, transform: `translateY(${ty}px)`, width: 940, textAlign: "center" }}>
              <Caption s={s} align="center" size={64} />
            </div>
          ))}
        </AbsoluteFill>
        {/* phone */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 150 }}>{phoneEl}</AbsoluteFill>
        {/* dots */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 90 }}>{dots}</AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // landscape
  return (
    <AbsoluteFill style={{ opacity: phoneOpacity }}>
      {/* header top-left */}
      <AbsoluteFill style={{ alignItems: "flex-start", justifyContent: "flex-start", padding: "70px 90px" }}>
        <div style={{ opacity: headOpacity, transform: `translateY(${headY}px)`, display: "flex", alignItems: "center", gap: 16 }}>
          <Shield size={64} />
          <span style={{ fontFamily: pop, fontSize: 54, fontWeight: 700, color: WHITE, letterSpacing: 2 }}>{appNameEn}</span>
        </div>
      </AbsoluteFill>
      {/* phone left */}
      <AbsoluteFill style={{ alignItems: "flex-start", justifyContent: "center", paddingLeft: 230 }}>
        {phoneEl}
      </AbsoluteFill>
      {/* caption right */}
      <AbsoluteFill style={{ alignItems: "flex-end", justifyContent: "center", paddingRight: 150 }}>
        <div style={{ width: 760, height: 300, position: "relative" }}>
          {captionStack.map(({ s, op, ty, key }) => (
            <div key={key} style={{ position: "absolute", top: 90, left: 0, right: 0, opacity: op, transform: `translateY(${ty}px)`, textAlign: "left" }}>
              <Caption s={s} align="left" size={76} />
            </div>
          ))}
        </div>
      </AbsoluteFill>
      {/* dots */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 60 }}>{dots}</AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- scene 3: CTA ----------

const Cta: React.FC<KavalPromoProps> = ({ appNameKn, cta }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height >= width;
  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const s = spring({ frame, fps, config: { damping: 13 } });
  const scale = interpolate(s, [0, 1], [0.6, 1]);

  return (
    <AbsoluteFill
      style={{
        opacity: fadeIn,
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(circle at 50% 40%, ${BRAND_LIGHT} 0%, ${BRAND} 46%, ${BRAND_DEEP} 100%)`,
      }}
    >
      <div style={{ transform: `scale(${scale})`, textAlign: "center" }}>
        <Shield size={portrait ? 300 : 240} />
        <div style={{ fontFamily: kn, fontSize: portrait ? 120 : 96, fontWeight: 700, color: WHITE, marginTop: 24 }}>{appNameKn}</div>
        <div
          style={{
            marginTop: 30,
            display: "inline-block",
            fontFamily: kn,
            fontSize: portrait ? 46 : 40,
            fontWeight: 600,
            color: BRAND_DEEP,
            background: WHITE,
            padding: "20px 48px",
            borderRadius: 999,
            boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
          }}
        >
          {cta}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- core + variants ----------

const KavalPromoCore: React.FC<KavalPromoProps & { config: Config }> = (props) => {
  const { config, music } = props;
  const { durationInFrames } = useVideoConfig();

  const phoneStart = config.introLen - 15;
  const phoneLen = config.screenDur * config.screens.length + 15;
  const ctaStart = phoneStart + config.screenDur * config.screens.length + 5;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {music ? (
        <Audio
          src={staticFile(music)}
          volume={(f) =>
            interpolate(f, [0, 18, durationInFrames - 35, durationInFrames], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      ) : null}
      <Background />
      <Sequence durationInFrames={config.introLen}>
        <BrandIntro {...props} />
      </Sequence>
      <Sequence from={phoneStart} durationInFrames={phoneLen}>
        <PhoneShowcase {...props} />
      </Sequence>
      <Sequence from={ctaStart}>
        <Cta {...props} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const KavalPromo: React.FC<KavalPromoProps> = (p) => <KavalPromoCore {...p} config={FULL} />;
export const KavalPromoShort: React.FC<KavalPromoProps> = (p) => <KavalPromoCore {...p} config={SHORT} />;
export const KavalPromoWide: React.FC<KavalPromoProps> = (p) => <KavalPromoCore {...p} config={WIDE} />;
