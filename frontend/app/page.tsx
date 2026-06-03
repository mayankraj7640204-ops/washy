"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { supabase } from "./lib/supabaseClient";

export default function Home() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<number | null>(null);
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Parallax
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const bgY = useTransform(scrollYProgress, [0, 1], [0, 150]);       // 0.3x speed
  const textY = useTransform(scrollYProgress, [0, 1], [0, 250]);     // 0.5x speed
  const polaroidX = useTransform(scrollYProgress, [0, 1], [0, -200]); // 0.4x leftward

  useEffect(() => {
    // Scroll reveal observer
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1, rootMargin: '-50px' });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    // Navbar scroll effect
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    setAuthLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      if (authTab === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setAuthSuccess(`Signed in! Welcome back, ${data.user?.email}`);
      } else {
        const fullName = formData.get('fullName') as string;
        const confirmPassword = formData.get('confirmPassword') as string;

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });
        if (error) throw error;

        if (data.session) {
          setAuthSuccess("Account created and signed in successfully!");
        } else {
          setAuthSuccess("Account created! Please check your email for a verification link.");
        }
      }
    } catch (err: any) {
      setAuthError(err.message || "An unexpected error occurred.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Booking & Payment States
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const [machineStatus, setMachineStatus] = useState<{
    occupied: boolean;
    reason?: 'active_wash' | 'pending_lock';
    remaining_seconds?: number;
    cycle_name?: string;
    user_email?: string;
    expires_at?: string;
  } | null>(null);
  const [workflowStep, setWorkflowStep] = useState<'selection' | 'otp_payment' | 'wash_timer'>('selection');
  const [currentBooking, setCurrentBooking] = useState<any>(null);
  const [otpTimeRemaining, setOtpTimeRemaining] = useState<number>(600);
  const [washTimeRemaining, setWashTimeRemaining] = useState<number>(0);

  // Sound generator
  const playCompletionBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playBeep = (delay: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + delay);
        osc.stop(audioCtx.currentTime + delay + 0.4);
      };
      playBeep(0);
      playBeep(0.4);
    } catch (err) {
      console.error("Failed to play completion beep:", err);
    }
  };

  // Auth Session Tracking
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setCurrentUser({ id: session.user.id, email: session.user.email || "" });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setCurrentUser({ id: session.user.id, email: session.user.email || "" });
      } else {
        setCurrentUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Poll Machine Occupancy Status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/bookings/status`);
        const data = await res.json();
        setMachineStatus(data);
      } catch (err) {
        console.error("Error fetching machine status:", err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  // Restore Booking state on user reload/login
  useEffect(() => {
    if (!currentUser) return;
    const checkUserBooking = async () => {
      try {
        const { data, error } = await supabase
          .from("bookings")
          .select("*")
          .eq("user_id", currentUser.id)
          .in("status", ["pending_payment", "active"])
          .order("created_at", { ascending: false })
          .limit(1);
          
        if (data && data.length > 0) {
          const b = data[0];
          if (b.status === "pending_payment") {
            const expires = new Date(b.expires_at).getTime();
            if (expires > Date.now()) {
              setCurrentBooking(b);
              setWorkflowStep("otp_payment");
            }
          } else if (b.status === "active") {
            const duration = b.duration_minutes * 60 * 1000;
            const completed = new Date(b.payment_completed_at).getTime();
            if (completed + duration > Date.now()) {
              setCurrentBooking(b);
              setWorkflowStep("wash_timer");
            }
          }
        }
      } catch (err) {
        console.error("Error restoring booking step:", err);
      }
    };
    checkUserBooking();
  }, [currentUser]);

  // Timer for OTP Reservation (10 mins)
  useEffect(() => {
    if (workflowStep !== 'otp_payment' || !currentBooking) return;
    const interval = setInterval(() => {
      const expiry = new Date(currentBooking.expires_at).getTime();
      const diff = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setOtpTimeRemaining(diff);
      if (diff === 0) {
        clearInterval(interval);
        alert("Your 10-minute booking lock has expired.");
        setWorkflowStep("selection");
        setCurrentBooking(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [workflowStep, currentBooking]);

  // Timer for Active Wash Countdown
  useEffect(() => {
    if (workflowStep !== 'wash_timer' || !currentBooking || !currentBooking.payment_completed_at) return;
    const interval = setInterval(() => {
      const started = new Date(currentBooking.payment_completed_at!).getTime();
      const duration = currentBooking.duration_minutes * 60 * 1000;
      const diff = Math.max(0, Math.floor((started + duration - Date.now()) / 1000));
      setWashTimeRemaining(diff);
      if (diff === 0) {
        clearInterval(interval);
        playCompletionBeep();
        
        // Notify backend of completion
        fetch(`${API_BASE_URL}/api/bookings/${currentBooking.id}/complete`, { method: "POST" })
          .catch(e => console.error("Error completing booking:", e));
          
        alert("Wash cycle completed! 🧼✨");
        setWorkflowStep("selection");
        setCurrentBooking(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [workflowStep, currentBooking]);

  // Actions
  const handleBookCycle = async (cycleName: string, duration: number) => {
    if (!currentUser) {
      document.getElementById("auth")?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          user_email: currentUser.email,
          cycle_name: cycleName,
          duration_minutes: duration
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to reserve slot.");
      }
      setCurrentBooking(data);
      setWorkflowStep("otp_payment");
    } catch (err: any) {
      alert(err.message || "An error occurred during booking.");
    }
  };

  const handlePayment = async () => {
    if (!currentBooking) return;

    if (currentBooking.id === "subscription") {
      setWorkflowStep("selection");
      setCurrentBooking(null);
      alert("Subscription trial activated successfully! Welcome to Washly Pro 🚀");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/bookings/${currentBooking.id}/pay`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Payment processing failed.");
      }
      setCurrentBooking(data);
      setWorkflowStep("wash_timer");
      alert("Payment successful! Active wash cycle started. Confirmation email sent.");
    } catch (err: any) {
      alert(err.message || "An error occurred during payment.");
    }
  };

  const handleStartTrial = () => {
    if (!currentUser) {
      document.getElementById("auth")?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setCurrentBooking({
      id: "subscription",
      cycle_name: "Washly Pro Subscription",
      duration_minutes: 0,
      otp: "SUB1",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });
    setOtpTimeRemaining(600);
    setWorkflowStep("otp_payment");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setWorkflowStep("selection");
    setCurrentBooking(null);
  };

  return (
    <>
      {/* ==================== ACTIVE CONSOLE OVERLAYS ==================== */}
      {workflowStep === 'otp_payment' && currentBooking && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'var(--linen)', overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '32px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7EC8E3" strokeWidth="1.5"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z" /></svg>
            <span className="tracked-caps" style={{ color: 'var(--slate)', fontSize: '20px', letterSpacing: '4px' }}>WASHLY CONSOLE</span>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '48px', maxWidth: '1000px', width: '100%'
          }}>
            {/* Left: OTP Locker Card */}
            <div className="glass-card" style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: '450px' }}>
              {currentBooking.id === "subscription" ? (
                <>
                  <p className="tracked-caps" style={{ color: 'rgba(26,26,46,0.5)', marginBottom: '24px', fontSize: '12px' }}>Subscription Package</p>
                  <h3 className="tracked-caps" style={{ color: 'var(--slate)', fontSize: '28px', marginBottom: '16px' }}>WASHLY PRO</h3>
                  <p style={{ fontSize: '15px', color: 'rgba(26,26,46,0.7)', lineHeight: 1.6, maxWidth: '280px', marginBottom: '32px' }}>
                    You are activating a <strong>14-day free trial</strong> of Washly Pro. You won&apos;t be charged today.
                  </p>
                  <div style={{ fontSize: '14px', color: 'var(--mouse)', fontFamily: "'Inter', sans-serif", lineHeight: 1.8 }}>
                    Trial price: <strong style={{ color: 'var(--sky)' }}>₹0.00</strong><br />
                    Then: <strong>₹1,200/month</strong>
                  </div>
                </>
              ) : (
                <>
                  <p className="tracked-caps" style={{ color: 'rgba(26,26,46,0.5)', marginBottom: '16px', fontSize: '12px' }}>Hardware Authorization Code</p>
                  
                  <div style={{
                    fontSize: '64px',
                    fontWeight: 700,
                    color: 'var(--slate)',
                    letterSpacing: '12px',
                    background: 'rgba(126, 200, 227, 0.08)',
                    padding: '24px 32px 24px 44px',
                    borderRadius: '16px',
                    border: '1px solid rgba(126, 200, 227, 0.2)',
                    margin: '24px 0',
                    fontFamily: "'DM Mono', monospace",
                    boxShadow: '0 8px 32px rgba(126, 200, 227, 0.1)'
                  }}>
                    {currentBooking.otp}
                  </div>

                  <p style={{ fontSize: '15px', color: 'rgba(26,26,46,0.7)', lineHeight: 1.6, maxWidth: '280px', marginBottom: '32px' }}>
                    Use this temporary 4-digit code on the washing machine keypad to authorize power startup.
                  </p>

                  <div style={{
                    background: 'rgba(26,26,46,0.03)',
                    padding: '12px 24px',
                    borderRadius: '9999px',
                    border: '1px solid rgba(26,26,46,0.05)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mouse)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                    <span style={{ fontSize: '13px', fontFamily: "'DM Mono', monospace", color: 'var(--slate)' }}>
                      Slot Reserved: <strong>{Math.floor(otpTimeRemaining / 60)}:{(otpTimeRemaining % 60).toString().padStart(2, '0')}</strong>
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Right: LinkPe UPI QR Payment Card (Image 2 design) */}
            <div className="glass-card" style={{ padding: '40px', background: 'white', border: '1px solid #e0e0e0', color: '#333', boxShadow: '0 8px 32px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              
              {/* LinkPe Header */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '20px' }}>
                {/* Logo emulation */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontWeight: 900, fontSize: '24px', color: '#333' }}>
                    Link<span style={{ color: '#00b894' }}>Pe</span>
                  </span>
                  {/* Two triangles: green and orange */}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ marginLeft: '2px' }}>
                    <polygon points="12 2, 2 22, 12 18" fill="#00b894" />
                    <polygon points="12 2, 22 22, 12 18" fill="#ff7675" />
                  </svg>
                </div>
                <span style={{ fontSize: '10px', color: '#666', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500 }}>
                  UPI Payment Link Generator Api
                </span>
              </div>

              {/* Subtitle */}
              <p style={{
                fontSize: '12px',
                color: '#222',
                fontWeight: 700,
                textAlign: 'center',
                lineHeight: 1.5,
                maxWidth: '260px',
                marginBottom: '20px',
                borderBottom: '1px dashed #ccc',
                paddingBottom: '12px'
              }}>
                Click on PayNow or Scan Qr and Pay using any UPI Apps To Pay Pt Prashnat Tripathi
              </p>

              {/* QR Code */}
              <div style={{
                background: '#fff',
                padding: '12px',
                border: '1px solid #e0e0e0',
                borderRadius: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.02)',
                marginBottom: '20px'
              }}>
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&color=1a1a2e&data=${encodeURIComponent(`upi://pay?pa=mayank@upi&pn=Pt Prashnat Tripathi&am=1200&cu=INR&tn=Washly ${currentBooking.cycle_name}`)}`} 
                  alt="UPI QR Code LinkPe"
                  style={{ width: '180px', height: '180px' }}
                />
              </div>

              {/* UPI Logos Container (Emulated) */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '12px 16px',
                width: '100%',
                maxWidth: '240px',
                marginBottom: '24px',
                opacity: 0.85
              }}>
                {/* 10 mock brands */}
                {['paytm', 'gpay', 'bhim', 'phonepe', 'jiomoney', 'whatsapp', 'amazonpay', 'payzapp', 'freecharge', 'mobikwik'].map((b) => (
                  <div key={b} style={{
                    height: '14px',
                    borderRadius: '3px',
                    background: 'rgba(0,0,0,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '7px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#666',
                    fontFamily: 'sans-serif'
                  }}>
                    {b.substring(0, 4)}
                  </div>
                ))}
              </div>

              {/* Green Pay Now Button */}
              <button 
                onClick={handlePayment}
                style={{
                  width: '100%',
                  background: '#2ecc71',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '14px 20px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'center',
                  boxShadow: '0 4px 12px rgba(46, 204, 113, 0.2)',
                  transition: 'transform 0.2s'
                }}
              >
                Click here to Pay Now
              </button>
            </div>
          </div>
        </div>
      )}

      {workflowStep === 'wash_timer' && currentBooking && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'var(--linen)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', overflow: 'hidden'
        }}>
          {/* Bubbles Wave Background */}
          <div className="water-wave" style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '40vh', background: 'rgba(126, 200, 227, 0.1)', zIndex: 0, transition: 'all 0.5s'
          }}>
            {/* Visual emulations of bubbles */}
            <div style={{ position: 'absolute', bottom: '15%', left: '10%', width: '12px', height: '12px', borderRadius: '50%', background: 'rgba(255,255,255,0.4)' }}></div>
            <div style={{ position: 'absolute', bottom: '30%', left: '45%', width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }}></div>
            <div style={{ position: 'absolute', bottom: '8%', left: '80%', width: '16px', height: '16px', borderRadius: '50%', background: 'rgba(255,255,255,0.4)' }}></div>
          </div>

          <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', maxWidth: '480px', width: '100%' }}>
            
            {/* Cycle Header */}
            <p className="tracked-caps" style={{ color: 'var(--sky)', fontSize: '14px', letterSpacing: '4px', marginBottom: '8px' }}>
              WASH CYCLE IN PROGRESS
            </p>
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '48px', color: 'var(--slate)', marginBottom: '32px' }}>
              {currentBooking.cycle_name.toUpperCase()}
            </h2>

            {/* Glowing Circular Timer Ring */}
            <div style={{
              width: '240px',
              height: '240px',
              borderRadius: '50%',
              border: '4px solid rgba(126, 200, 227, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.5)',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 20px 50px rgba(126, 200, 227, 0.12), inset 0 0 20px rgba(126, 200, 227, 0.05)',
              marginBottom: '40px',
              position: 'relative'
            }}>
              <div style={{
                fontSize: '48px',
                fontWeight: 700,
                color: 'var(--slate)',
                fontFamily: "'DM Mono', monospace"
              }}>
                {Math.floor(washTimeRemaining / 60)}:{(washTimeRemaining % 60).toString().padStart(2, '0')}
              </div>
              <span className="tracked-caps" style={{ fontSize: '9px', color: 'rgba(26,26,46,0.4)', marginTop: '8px', letterSpacing: '2px' }}>
                Remaining
              </span>
            </div>

            {/* Progress Bar */}
            <div style={{
              width: '100%',
              height: '6px',
              background: 'rgba(26,26,46,0.05)',
              borderRadius: '9999px',
              overflow: 'hidden',
              marginBottom: '24px'
            }}>
              <div style={{
                height: '100%',
                background: 'var(--sky)',
                width: `${(washTimeRemaining / (currentBooking.duration_minutes * 60)) * 100}%`,
                transition: 'width 1.1s linear',
                boxShadow: '0 0 8px rgba(126, 200, 227, 0.8)'
              }}></div>
            </div>

            {/* Status updates */}
            <p style={{ fontSize: '15px', color: 'rgba(26,26,46,0.7)', lineHeight: 1.6 }}>
              Washing machine is powered up. A high-frequency beep sounds will alert you on completion.
            </p>
          </div>
        </div>
      )}

      {/* ==================== NAVIGATION ==================== */}
      <nav id="navbar" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'all 0.5s',
        background: isScrolled ? 'rgba(248,246,242,0.85)' : 'transparent',
        backdropFilter: isScrolled ? 'blur(12px)' : 'none',
        borderBottom: isScrolled ? '1px solid rgba(26,26,46,0.05)' : 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7EC8E3" strokeWidth="1.5"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z" /></svg>
          <span className="tracked-caps" style={{ color: 'var(--slate)' }}>Washly</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }} className="hidden md:flex">
          <a href="#features" className="nav-link tracked-caps">Features</a>
          <a href="#cycles" className="nav-link tracked-caps">Cycles</a>
          <a href="#pricing" className="nav-link tracked-caps">Pricing</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          {currentUser ? (
            <>
              <span className="tracked-caps" style={{ color: 'var(--slate)', fontSize: '12px' }}>
                Hello, {currentUser.email.split('@')[0]}
              </span>
              <button onClick={handleLogout} className="nav-link tracked-caps" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                Logout
              </button>
            </>
          ) : (
            <>
              <a href="#auth" className="nav-link tracked-caps">Login</a>
              <button onClick={() => document.getElementById("auth")?.scrollIntoView({ behavior: 'smooth' })} className="pill-btn" style={{ padding: '10px 24px', fontSize: '11px' }}>Start Free</button>
            </>
          )}
        </div>
      </nav>

      {/* ==================== HERO ==================== */}
      <section id="hero" ref={heroRef} style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', background: 'var(--linen)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

        {/* Background — Plane 0 (parallax 0.3x) */}
        <motion.div style={{ position: 'absolute', inset: 0, zIndex: 0, y: bgY, willChange: 'transform' }}>
          <img src="https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1920&q=85" style={{ width: '100%', height: '120%', objectFit: 'cover' }} alt="Laundry room" />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(248,246,242,0.45) 0%, rgba(248,246,242,0.15) 40%, rgba(248,246,242,0.5) 80%, rgba(248,246,242,0.85) 100%)' }}></div>
        </motion.div>

        {/* Typography — Plane 1 (parallax 0.5x, BEHIND the foreground linen) */}
        <motion.div style={{ position: 'absolute', inset: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', y: textY, willChange: 'transform' }}>
          <h1 className="hero-title" style={{
            fontFamily: "'Bebas Neue',sans-serif", fontSize: 'clamp(6rem,18vw,22rem)', letterSpacing: '-0.02em', lineHeight: 0.9,
            color: 'rgba(26,26,46,0.22)'
          }}>
            WASHLY
          </h1>
        </motion.div>

        {/* Foreground Linen Stack — Plane 2 (IN FRONT of the text, covers lower letterforms) */}
        <div className="animate-fade-in-up" style={{ 
          position: 'absolute', bottom: '-2%', left: '50%', transform: 'translateX(-50%)', zIndex: 2, width: 'min(520px, 45vw)',
        }}>
          <img src="https://images.unsplash.com/photo-1616627547584-bf28cee262db?w=600&q=85" style={{ width: '100%', height: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 20px 60px rgba(0,0,0,0.18))' }} alt="Folded linen stack" />
        </div>

        {/* Linen Stack */}
        <div className="linen-stack" style={{ position: 'absolute', right: '5%', bottom: '18%', zIndex: 30, width: '260px', animation: 'fadeInUp 1s 0.6s cubic-bezier(0.16,1,0.3,1) forwards', opacity: 0 }}>
          <img src="https://images.unsplash.com/photo-1616627547584-bf28cee262db?w=400&q=85" style={{ width: '100%', height: 'auto', filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.15))' }} alt="Folded linen" />
        </div>

        {/* Social Icons Edge */}
        <div className="social-edge" style={{ position: 'absolute', right: '32px', top: '50%', transform: 'translateY(-50%)', zIndex: 40, display: 'flex', flexDirection: 'column', gap: '24px', opacity: 0, animation: 'fadeIn 0.8s 0.8s forwards' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="social-icon-hover"><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="social-icon-hover"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" /></svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="social-icon-hover"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>
        </div>

        {/* Polaroid Strip */}
        <motion.div className="polaroid-strip" style={{ position: 'absolute', bottom: '8%', left: '5%', zIndex: 40, display: 'flex', gap: '16px', opacity: 0, animation: 'fadeInUp 1s 0.5s cubic-bezier(0.16,1,0.3,1) forwards', x: polaroidX, willChange: 'transform' }}>
          {[
            { img: 'photo-1582735689369-4fe89db7114c', name: 'Eco Clean', sub: 'washes per month tracked', rotate: -3 },
            { img: '/quick_wash.png', name: 'Quick Wash', sub: 'avg. 38 min saved', rotate: 2 },
            { img: 'photo-1584622650111-993a426fbf0a', name: 'Rinse & Clean', sub: '40% less water used', rotate: -2 },
            { img: '/normal_wash.png', name: 'Normal Wash', sub: 'freshness, guaranteed', rotate: 3 },
            { img: '/wash.png', name: 'Wash', sub: 'your laundry. your schedule.', rotate: -1 },
          ].map((card) => (
            <motion.div
              key={card.name}
              className="polaroid"
              style={{ transform: `rotate(${card.rotate}deg)` }}
              whileHover={{ y: -8, scale: 1.02, rotate: 0, boxShadow: '0 20px 48px rgba(126, 200, 227, 0.25)' }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <img src={card.img.startsWith('/') ? card.img : `https://images.unsplash.com/${card.img}?w=400&q=80`} alt={card.name} />
              <div style={{ paddingTop: '10px', paddingLeft: '4px' }}>
                <p className="tracked-caps" style={{ fontSize: '9px', color: 'var(--slate)' }}>{card.name}</p>
                <p className="mouse-type" style={{ marginTop: '2px' }}>{card.sub}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Get Started Button */}
        <div style={{ position: 'absolute', right: '8%', bottom: '8%', zIndex: 40, opacity: 0, animation: 'fadeInUp 0.8s 1s cubic-bezier(0.16,1,0.3,1) forwards' }} className="linen-stack">
          <button className="pill-btn" style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(8px)', borderColor: 'rgba(255,255,255,0.5)', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
            Get Started
          </button>
        </div>
      </section>

      {/* ==================== ABOUT ==================== */}
      <section id="features" style={{ width: '100%', padding: '128px 0 0 0', background: 'var(--linen)' }}>
        {/* Heading */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '80px', padding: '0 32px' }}>
          <div className="hairline" style={{ flex: 1 }}></div>
          <h2 className="reveal" style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 'clamp(2.5rem,6vw,5rem)', color: 'var(--slate)', textAlign: 'center', whiteSpace: 'nowrap' }}>
            SMART LAUNDRY, SIMPLY DONE
          </h2>
          <div className="hairline" style={{ flex: 1 }}></div>
        </div>

        {/* Two Column */}
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '96px' }}>
          {/* Left: Text */}
          <div className="reveal" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 'clamp(1.25rem,2vw,1.75rem)', color: 'rgba(26,26,46,0.8)', lineHeight: 1.6, marginBottom: '32px' }}>
              Washly gives you complete control over every cycle, every load, every drop of water.
              <span style={{ color: 'var(--sky)', transition: 'opacity 0.6s' }}> Five intelligent wash modes</span>.
              One calm interface.
            </p>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 'clamp(1.25rem,2vw,1.75rem)', color: 'rgba(26,26,46,0.8)', lineHeight: 1.6 }}>
              No more guesswork. No wasted cycles. Washly
              <span style={{ color: 'var(--sky)', transition: 'opacity 0.6s' }}> learns your habits</span>,
              optimizes your settings, and reminds you exactly when your laundry is done.
            </p>
          </div>

          {/* Right: Timeline */}
          <div>
            {[
              { title: 'Wash', desc: 'Full deep clean, all fabric types', imgs: ['photo-1582735689369-4fe89db7114c', '/wash.png'], hasLine: true },
              { title: 'Quick Wash', desc: '15 minutes, lightly soiled garments', imgs: ['/quick_wash.png', 'photo-1584622650111-993a426fbf0a'], hasLine: true },
              { title: 'Rinse & Clean', desc: 'Post-wash freshness pass', imgs: ['photo-1545173168-9f1947eebb8f', 'photo-1616627547584-bf28cee262db'], hasLine: true },
              { title: 'Eco Clean', desc: 'Low temp, low water, maximum care', imgs: ['photo-1416879595882-3373a0480b5b', 'photo-1616627547584-bf28cee262db'], hasLine: true },
              { title: 'Normal Wash', desc: 'Your reliable everyday cycle', imgs: ['photo-1582735689369-4fe89db7114c', '/normal_wash.png'], hasLine: false },
            ].map((node, idx) => (
              <motion.div
                key={node.title}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: idx * 0.15 }}
                style={{ display: 'flex', gap: '24px', marginBottom: node.hasLine ? '8px' : undefined }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div className="timeline-dot"></div>
                  {node.hasLine && <div className="timeline-line"></div>}
                </div>
                <div style={{ paddingBottom: '40px' }}>
                  <h4 style={{ fontFamily: "'Inter',sans-serif", fontWeight: 500, color: 'var(--slate)', fontSize: '18px', marginBottom: '4px' }}>{node.title}</h4>
                  <p style={{ fontSize: '14px', color: 'rgba(26,26,46,0.6)', lineHeight: 1.6, marginBottom: '16px' }}>{node.desc}</p>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <img src={node.imgs[0].startsWith('/') ? node.imgs[0] : `https://images.unsplash.com/${node.imgs[0]}?w=200&q=80`} style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '8px', transform: 'rotate(-2deg)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} alt="" />
                    <img src={node.imgs[1].startsWith('/') ? node.imgs[1] : `https://images.unsplash.com/${node.imgs[1]}?w=200&q=80`} style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '8px', transform: 'rotate(2deg)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginLeft: '-30px' }} alt="" />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== CYCLES ==================== */}
      <section id="cycles" style={{ width: '100%', padding: '48px 0 128px 0', background: 'var(--linen)' }}>
        {/* Heading */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '64px', padding: '0 32px' }}>
          <h2 className="reveal" style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 'clamp(2.5rem,6vw,5rem)', color: 'var(--slate)' }}>
            CHOOSE YOUR CYCLE
          </h2>
          <div className="hairline" style={{ flex: 1 }}></div>
        </div>

        {/* Occupancy Banner */}
        {machineStatus?.occupied && (
          <div style={{
            maxWidth: '1280px',
            margin: '-32px auto 48px',
            padding: '0 32px'
          }}>
            <div style={{
              background: 'rgba(126, 200, 227, 0.08)',
              border: '1px solid rgba(126, 200, 227, 0.2)',
              borderRadius: '12px',
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="pulse-ring" style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#7EC8E3' }}></span>
                <span style={{ fontSize: '14px', color: 'var(--slate)', fontFamily: "'Inter', sans-serif" }}>
                  <strong>Machine Reserved:</strong> Currently running <strong>{machineStatus.cycle_name}</strong> ({machineStatus.reason === 'active_wash' ? 'Active Wash' : 'Pending Payment'}).
                </span>
              </div>
              <div style={{ fontSize: '14px', fontFamily: "'DM Mono', monospace", color: 'var(--slate)' }}>
                Time remaining: <strong>{Math.floor(machineStatus.remaining_seconds! / 60)}m {machineStatus.remaining_seconds! % 60}s</strong>
              </div>
            </div>
          </div>
        )}

        {/* Bento Grid */}
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '24px' }}>

          {[
            { id: 1, name: "Wash", time: "~55 min", desc: "Full deep clean. All fabrics, all loads.", icon: <><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /></> },
            { id: 2, name: "Quick Wash", time: "~15 min", desc: "Fast refresh for lightly soiled items.", icon: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /> },
            { id: 3, name: "Rinse & Clean", time: "~20 min", desc: "A thorough rinse pass for post-wash freshness.", icon: <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z" /> },
            { id: 4, name: "Eco Clean", time: "~70 min", desc: "Low temperature, minimal water. Maximum fabric care.", icon: <><path d="M11 20A7 7 0 0 1 9.8 6.6C11.5 5.4 13 4 13 4s1.5 1.4 3.2 2.6A7 7 0 0 1 11 20z" /><path d="M11 20v-9" /><path d="M11 11l-2-2" /><path d="M11 11l2-2" /></> },
            { id: 5, name: "Normal Wash", time: "~38 min", desc: "Your reliable everyday cycle.", icon: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></> }
          ].map((cycle) => {
            const isSelected = selectedCycle === cycle.id;
            const hasSelection = selectedCycle !== null;
            return (
              <motion.div
                key={cycle.id}
                className={`glass-card cycle-card ${isSelected ? 'selected' : ''}`}
                style={{
                  position: 'relative', cursor: 'pointer',
                  opacity: hasSelection && !isSelected ? 0.6 : 1,
                  background: isSelected ? 'rgba(126, 200, 227, 0.08)' : undefined,
                }}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: hasSelection && !isSelected ? 0.6 : 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ scale: 1.02 }}
                onClick={() => setSelectedCycle(isSelected ? null : cycle.id)}
              >
                {isSelected && <div className="pulse-ring"></div>}
                <div style={{ color: 'var(--sky)', marginBottom: '24px' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    {cycle.icon}
                  </svg>
                </div>
                <h3 className="tracked-caps" style={{ color: 'var(--slate)', marginBottom: '12px' }}>{cycle.name}</h3>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '9999px', padding: '6px 12px', marginBottom: '16px',
                  background: isSelected ? 'var(--sky)' : 'rgba(26,26,46,0.05)',
                  transition: 'background 0.3s',
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isSelected ? 'white' : 'var(--mouse)'} strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: '11px', color: isSelected ? 'white' : 'var(--mouse)', transition: 'color 0.3s' }}>{cycle.time}</span>
                </div>
                <p style={{ fontSize: '14px', color: 'rgba(26,26,46,0.7)', lineHeight: 1.6 }}>{cycle.desc}</p>
                {isSelected && (
                  <div style={{ marginTop: '24px' }}>
                    {currentUser ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const mins = cycle.id === 1 ? 55 : cycle.id === 2 ? 15 : cycle.id === 3 ? 20 : cycle.id === 4 ? 70 : 38;
                          handleBookCycle(cycle.name, mins);
                        }}
                        className="pill-btn"
                        style={{
                          width: '100%',
                          background: machineStatus?.occupied ? 'rgba(26,26,46,0.05)' : 'var(--sky)',
                          color: machineStatus?.occupied ? 'rgba(26,26,46,0.3)' : 'white',
                          borderColor: machineStatus?.occupied ? 'rgba(26,26,46,0.1)' : 'var(--sky)',
                          cursor: machineStatus?.occupied ? 'not-allowed' : 'pointer'
                        }}
                        disabled={machineStatus?.occupied}
                      >
                        {machineStatus?.occupied ? 'Machine Occupied' : 'Book & Generate OTP'}
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById("auth")?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="pill-btn"
                        style={{
                          width: '100%',
                          background: 'rgba(26,26,46,0.05)',
                          color: 'var(--slate)',
                          borderColor: 'rgba(26,26,46,0.1)'
                        }}
                      >
                        Login to Book
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}

        </div>
      </section>

      {/* ==================== AUTH ==================== */}
      <section id="auth" style={{ position: 'relative', width: '100%', minHeight: '100vh', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        {/* Background */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <img src="https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1920&q=85" style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Bed linen" />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,46,0.35)' }}></div>
        </div>

        {/* Auth Panel */}
        <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '1280px', margin: '0 auto', padding: '128px 32px' }}>
          <div style={{ maxWidth: '420px' }}>
            <div className="reveal" style={{ marginBottom: '32px' }}>
              <h2 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 'clamp(3rem,5vw,4rem)', color: 'white', marginBottom: '16px' }}>WELCOME BACK</h2>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", color: 'rgba(255,255,255,0.6)', fontSize: '20px' }}>Your laundry is waiting. Sign in to manage your cycles.</p>
            </div>

            <div className="reveal glass" style={{ borderRadius: '16px', padding: '40px' }}>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: '32px', marginBottom: '32px', position: 'relative' }}>
                <button className="tracked-caps" style={{ background: 'none', border: 'none', color: authTab === 'login' ? 'white' : 'rgba(255,255,255,0.4)', paddingBottom: '12px', cursor: 'pointer' }} onClick={() => { setAuthTab('login'); setAuthError(null); setAuthSuccess(null); }} disabled={authLoading}>Log In</button>
                <button className="tracked-caps" style={{ background: 'none', border: 'none', color: authTab === 'signup' ? 'white' : 'rgba(255,255,255,0.4)', paddingBottom: '12px', cursor: 'pointer' }} onClick={() => { setAuthTab('signup'); setAuthError(null); setAuthSuccess(null); }} disabled={authLoading}>Sign Up</button>
                <motion.div layoutId="tab-indicator" className="tab-indicator" style={{ left: authTab === 'login' ? '0' : '80px', width: authTab === 'login' ? '50px' : '65px' }} />
              </div>

              {/* Status Feedback */}
              <AnimatePresence>
                {authError && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    style={{
                      marginBottom: '24px',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      color: '#ff8a8a',
                      fontSize: '13px',
                      fontFamily: "'Inter', sans-serif"
                    }}
                  >
                    {authError}
                  </motion.div>
                )}
                {authSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    style={{
                      marginBottom: '24px',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      background: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      color: '#a7f3d0',
                      fontSize: '13px',
                      fontFamily: "'Inter', sans-serif"
                    }}
                  >
                    {authSuccess}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="wait">
                {authTab === 'login' ? (
                  <motion.div
                    key="login"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <form onSubmit={handleFormSubmit}>
                      <div style={{ marginBottom: '24px' }}>
                        <input type="email" name="email" placeholder="Email address" className="auth-input" required disabled={authLoading} />
                      </div>
                      <div style={{ marginBottom: '24px' }}>
                        <input type="password" name="password" placeholder="Password" className="auth-input" required disabled={authLoading} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                          <input type="checkbox" className="custom-checkbox" disabled={authLoading} />
                          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>Remember me</span>
                        </label>
                        <button type="button" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '13px', cursor: 'pointer' }} disabled={authLoading}>Forgot password?</button>
                      </div>
                      <button type="submit" className="pill-btn" style={{ width: '100%', background: 'rgba(255,255,255,0.9)', border: 'none', color: 'var(--slate)', cursor: authLoading ? 'not-allowed' : 'pointer' }} disabled={authLoading}>
                        {authLoading ? 'Signing In...' : 'Sign In'}
                      </button>
                      <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '13px', marginTop: '20px' }}>Don&apos;t have an account? <button type="button" style={{ background: 'none', border: 'none', color: 'var(--sky)', cursor: 'pointer' }} onClick={() => { setAuthTab('signup'); setAuthError(null); setAuthSuccess(null); }} disabled={authLoading}>Sign up</button></p>
                    </form>
                  </motion.div>
                ) : (
                  <motion.div
                    key="signup"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <form onSubmit={handleFormSubmit}>
                      <div style={{ marginBottom: '24px' }}>
                        <input type="text" name="fullName" placeholder="Full name" className="auth-input" required disabled={authLoading} />
                      </div>
                      <div style={{ marginBottom: '24px' }}>
                        <input type="email" name="email" placeholder="Email address" className="auth-input" required disabled={authLoading} />
                      </div>
                      <div style={{ marginBottom: '24px' }}>
                        <input type="password" name="password" placeholder="Password" className="auth-input" required disabled={authLoading} />
                      </div>
                      <div style={{ marginBottom: '32px' }}>
                        <input type="password" name="confirmPassword" placeholder="Confirm password" className="auth-input" required disabled={authLoading} />
                      </div>
                      <button type="submit" className="pill-btn" style={{ width: '100%', background: 'rgba(255,255,255,0.9)', border: 'none', color: 'var(--slate)', cursor: authLoading ? 'not-allowed' : 'pointer' }} disabled={authLoading}>
                        {authLoading ? 'Creating Account...' : 'Create Account'}
                      </button>
                      <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '13px', marginTop: '20px' }}>Already have an account? <button type="button" style={{ background: 'none', border: 'none', color: 'var(--sky)', cursor: 'pointer' }} onClick={() => { setAuthTab('login'); setAuthError(null); setAuthSuccess(null); }} disabled={authLoading}>Log in</button></p>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== PRICING ==================== */}
      <section id="pricing" style={{ width: '100%', padding: '128px 0', background: 'var(--linen)' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', padding: '0 32px', textAlign: 'center' }}>
          <h2 className="reveal" style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 'clamp(2rem,5vw,4rem)', color: 'var(--slate)', marginBottom: '64px' }}>
            ONE PLAN. EVERYTHING INCLUDED.
          </h2>

          <div className="reveal glass-card" style={{ padding: '48px 40px', position: 'relative', overflow: 'hidden', boxShadow: '0 0 60px rgba(126,200,227,0.15),0 4px 24px rgba(0,0,0,0.06)' }}>
            {/* Glows */}
            <div style={{ position: 'absolute', top: '-80px', right: '-80px', width: '160px', height: '160px', background: 'rgba(126,200,227,0.2)', borderRadius: '50%', filter: 'blur(40px)' }}></div>
            <div style={{ position: 'absolute', bottom: '-80px', left: '-80px', width: '160px', height: '160px', background: 'rgba(184,212,200,0.2)', borderRadius: '50%', filter: 'blur(40px)' }}></div>

            <div style={{ position: 'relative', zIndex: 10 }}>
              <p className="tracked-caps" style={{ color: 'rgba(26,26,46,0.6)', marginBottom: '24px' }}>Washly Pro</p>
              <div style={{ marginBottom: '12px' }}>
                <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 'clamp(4rem,8vw,5rem)', color: 'var(--slate)' }}>₹1,200</span>
                <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: '1.5rem', color: 'rgba(26,26,46,0.6)', marginLeft: '8px' }}>/month</span>
              </div>
              <p className="mouse-type" style={{ marginBottom: '40px' }}>or ₹9,999/year — save 30%</p>

              <div style={{ maxWidth: '280px', margin: '0 auto 40px', textAlign: 'left' }}>
                <div className="reveal" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sky)" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  <span style={{ color: 'rgba(26,26,46,0.8)', fontSize: '14px' }}>All 5 wash cycles</span>
                </div>
                <div className="reveal" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sky)" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  <span style={{ color: 'rgba(26,26,46,0.8)', fontSize: '14px' }}>Smart scheduling & reminders</span>
                </div>
                <div className="reveal" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sky)" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  <span style={{ color: 'rgba(26,26,46,0.8)', fontSize: '14px' }}>Usage analytics dashboard</span>
                </div>
                <div className="reveal" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sky)" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  <span style={{ color: 'rgba(26,26,46,0.8)', fontSize: '14px' }}>Water & energy saving reports</span>
                </div>
                <div className="reveal" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sky)" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  <span style={{ color: 'rgba(26,26,46,0.8)', fontSize: '14px' }}>Multi-machine support</span>
                </div>
                <div className="reveal" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sky)" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  <span style={{ color: 'rgba(26,26,46,0.8)', fontSize: '14px' }}>Priority support</span>
                </div>
              </div>

              <button onClick={handleStartTrial} className="pill-btn" style={{ width: '100%', background: 'white', borderColor: 'rgba(26,26,46,0.1)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                Start Free 14-Day Trial
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer style={{ width: '100%', background: 'var(--linen)', borderTop: '1px solid rgba(26,26,46,0.1)' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', gap: '32px' }} className="md:flex-row">
            {/* Left */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7EC8E3" strokeWidth="1.5"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z" /></svg>
                <span className="tracked-caps" style={{ color: 'var(--slate)' }}>Washly</span>
              </div>
              <p className="mouse-type">Clean clothes. Clear mind.</p>
            </div>

            {/* Center */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <a href="#features" className="tracked-caps footer-link">Features</a>
              <a href="#cycles" className="tracked-caps footer-link">Cycles</a>
              <a href="#pricing" className="tracked-caps footer-link">Pricing</a>
              <span className="tracked-caps footer-link" style={{ cursor: 'pointer' }}>Privacy</span>
              <span className="tracked-caps footer-link" style={{ cursor: 'pointer' }}>Terms</span>
            </div>

            {/* Right */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="social-icon-hover"><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="social-icon-hover"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" /></svg>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="social-icon-hover"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>
            </div>
          </div>

          <div style={{ marginTop: '40px', paddingTop: '24px', borderTop: '1px solid rgba(26,26,46,0.1)', textAlign: 'center' }}>
            <p className="mouse-type">&copy; 2025 Washly. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
