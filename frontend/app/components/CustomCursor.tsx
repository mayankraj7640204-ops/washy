"use client";

import { useEffect, useRef, useState } from "react";

export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const pos = useRef({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [cursorLabel, setCursorLabel] = useState("");
  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    // Respect prefers-reduced-motion
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);

    const handleMouseMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouseMove);

    // Hover detection
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const interactive = target.closest("a, button, .pill-btn, .nav-link, .cycle-card, input, textarea, .polaroid");
      if (interactive) {
        setIsHovering(true);
        const cycleCard = target.closest(".cycle-card");
        if (cycleCard) {
          const nameEl = cycleCard.querySelector(".tracked-caps");
          setCursorLabel(nameEl?.textContent || "");
        } else {
          setCursorLabel("");
        }
      } else {
        setIsHovering(false);
        setCursorLabel("");
      }
    };
    document.addEventListener("mouseover", handleMouseOver);

    // Lerp animation
    let raf: number;
    const lerp = (a: number, b: number, n: number) => a + (b - a) * n;
    const animate = () => {
      pos.current.x = lerp(pos.current.x, mouse.current.x, 0.12);
      pos.current.y = lerp(pos.current.y, mouse.current.y, 0.12);
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${pos.current.x - 4}px, ${pos.current.y - 4}px)`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${pos.current.x - 16}px, ${pos.current.y - 16}px)`;
      }
      if (labelRef.current) {
        labelRef.current.style.transform = `translate(${pos.current.x + 20}px, ${pos.current.y - 6}px)`;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    // Add cursor:none to body
    document.body.style.cursor = "none";

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", checkMobile);
      document.removeEventListener("mouseover", handleMouseOver);
      cancelAnimationFrame(raf);
      document.body.style.cursor = "";
    };
  }, []);

  if (isMobile) return null;

  return (
    <>
      {/* Dot */}
      <div
        ref={dotRef}
        style={{
          position: "fixed",
          top: 0, left: 0,
          width: isHovering ? 0 : 8,
          height: isHovering ? 0 : 8,
          borderRadius: "50%",
          background: "#1A1A2E",
          pointerEvents: "none",
          zIndex: 9999,
          mixBlendMode: "multiply",
          transition: "width 0.2s, height 0.2s",
        }}
      />
      {/* Ring */}
      <div
        ref={ringRef}
        style={{
          position: "fixed",
          top: 0, left: 0,
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: isHovering ? "1.5px solid #7EC8E3" : "1.5px solid transparent",
          background: "transparent",
          pointerEvents: "none",
          zIndex: 9999,
          mixBlendMode: "multiply",
          transition: "border-color 0.2s, opacity 0.2s",
          opacity: isHovering ? 1 : 0,
        }}
      />
      {/* Label */}
      {cursorLabel && (
        <div
          ref={labelRef}
          style={{
            position: "fixed",
            top: 0, left: 0,
            fontSize: "9px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 400,
            color: "#7EC8E3",
            pointerEvents: "none",
            zIndex: 9999,
            whiteSpace: "nowrap",
          }}
        >
          {cursorLabel}
        </div>
      )}
    </>
  );
}
