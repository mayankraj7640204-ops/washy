import os
import random
import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY in environment variables.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI(title="Washly Laundry Booking API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class BookingCreate(BaseModel):
    user_id: str
    user_email: str
    cycle_name: str
    duration_minutes: int

def send_confirmation_email(user_email: str, cycle_name: str, duration_minutes: int, otp: str):
    subject = "Washly Booking Confirmed!"
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {{ font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f8f6f2; color: #1a1a2e; padding: 40px; margin: 0; }}
        .card {{ background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; }}
        .header {{ font-size: 24px; font-weight: bold; color: #1a1a2e; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 1px; }}
        .otp {{ font-size: 32px; font-weight: bold; color: #7EC8E3; background: #f0f7f9; padding: 12px 24px; border-radius: 8px; display: inline-block; letter-spacing: 4px; margin: 16px 0; }}
        .details {{ border-top: 1px solid #eee; padding-top: 20px; margin-top: 20px; line-height: 1.6; font-size: 14px; color: #555; }}
        .footer {{ font-size: 12px; color: #888; margin-top: 40px; text-align: center; }}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">Washly Booking Confirmed</div>
        <p>Hi there,</p>
        <p>Your booking for the <strong>{cycle_name}</strong> cycle has been confirmed and paid successfully!</p>
        <p>Your hardware activation OTP is:</p>
        <div class="otp">{otp}</div>
        <p>Please enter this 4-digit OTP on the washing machine keypad to activate its power supply.</p>
        <div class="details">
          <strong>Booking Details:</strong><br>
          • Cycle: {cycle_name}<br>
          • Duration: {duration_minutes} minutes<br>
          • Status: Active<br>
        </div>
        <div class="footer">&copy; 2025 Washly. Clean clothes, clear mind.</div>
      </div>
    </body>
    </html>
    """

    # 1. Always write to a local log file inside laundry project for complete visibility and mock reliability
    log_dir = "/Users/mayankraj/Desktop/Laundry/tmp"
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "emails.log")
    
    with open(log_path, "a") as f:
        timestamp = datetime.datetime.now().isoformat()
        f.write(f"\n========================================\n")
        f.write(f"TIMESTAMP: {timestamp}\n")
        f.write(f"TO: {user_email}\n")
        f.write(f"SUBJECT: {subject}\n")
        f.write(f"OTP: {otp}\n")
        f.write(f"BODY:\n{html_content}\n")
        f.write(f"========================================\n")

    print(f"[MOCK EMAIL SENT TO {user_email}] OTP: {otp}. Logged to {log_path}")

    # 2. Attempt real SMTP sending if environment is configured
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = os.getenv("SMTP_PORT", "587")
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASSWORD")

    if smtp_host and smtp_user and smtp_pass:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = smtp_user
            msg["To"] = user_email
            msg.attach(MIMEText(html_content, "html"))
            
            with smtplib.SMTP(smtp_host, int(smtp_port)) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, user_email, msg.as_string())
            print(f"[REAL EMAIL SENT] Successfully sent real confirmation email to {user_email}")
        except Exception as e:
            print(f"[REAL EMAIL FAILED] Error sending real email: {e}")

@app.get("/api/bookings/status")
def get_status():
    """
    Checks if there is an active lock or active wash cycle running.
    """
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    # Check for active washes
    response_active = supabase.table("bookings")\
        .select("*")\
        .eq("status", "active")\
        .order("payment_completed_at", desc=True)\
        .execute()
    
    for b in response_active.data:
        duration = b["duration_minutes"]
        completed_at = datetime.datetime.fromisoformat(b["payment_completed_at"].replace("Z", "+00:00"))
        time_elapsed = (datetime.datetime.now(datetime.timezone.utc) - completed_at).total_seconds()
        total_seconds = duration * 60
        
        if time_elapsed < total_seconds:
            # Active wash still running
            remaining_seconds = int(total_seconds - time_elapsed)
            return {
                "occupied": True,
                "reason": "active_wash",
                "remaining_seconds": remaining_seconds,
                "cycle_name": b["cycle_name"],
                "user_email": b["user_email"],
                "expires_at": (completed_at + datetime.timedelta(minutes=duration)).isoformat()
            }
            
    # Check for pending payments (10 min locks)
    response_pending = supabase.table("bookings")\
        .select("*")\
        .eq("status", "pending_payment")\
        .order("created_at", desc=True)\
        .execute()
        
    for b in response_pending.data:
        expires_at = datetime.datetime.fromisoformat(b["expires_at"].replace("Z", "+00:00"))
        if datetime.datetime.now(datetime.timezone.utc) < expires_at:
            remaining_seconds = int((expires_at - datetime.datetime.now(datetime.timezone.utc)).total_seconds())
            return {
                "occupied": True,
                "reason": "pending_lock",
                "remaining_seconds": remaining_seconds,
                "cycle_name": b["cycle_name"],
                "user_email": b["user_email"],
                "expires_at": b["expires_at"]
            }

    return {"occupied": False}

@app.post("/api/bookings")
def create_booking(booking: BookingCreate):
    # First check status to enforce exclusive slots
    status_check = get_status()
    if status_check["occupied"]:
        raise HTTPException(
            status_code=400,
            detail="Washing machine is currently occupied. Please wait until the current session ends."
        )
        
    # Generate random 4-digit OTP
    otp = f"{random.randint(1000, 9999)}"
    
    # Calculate expiry (10 mins)
    now = datetime.datetime.now(datetime.timezone.utc)
    expires_at = now + datetime.timedelta(minutes=10)
    
    # Create booking record
    new_booking = {
        "user_id": booking.user_id,
        "user_email": booking.user_email,
        "cycle_name": booking.cycle_name,
        "duration_minutes": booking.duration_minutes,
        "otp": otp,
        "status": "pending_payment",
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat()
    }
    
    try:
        response = supabase.table("bookings").insert(new_booking).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Failed to create booking.")
        return response.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/api/bookings/{booking_id}/pay")
def pay_booking(booking_id: str):
    # Fetch booking
    response = supabase.table("bookings").select("*").eq("id", booking_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Booking not found.")
        
    booking = response.data[0]
    if booking["status"] != "pending_payment":
        raise HTTPException(
            status_code=400, 
            detail=f"Booking is already in state: {booking['status']}"
        )
        
    # Verify expiration
    expires_at = datetime.datetime.fromisoformat(booking["expires_at"].replace("Z", "+00:00"))
    if datetime.datetime.now(datetime.timezone.utc) > expires_at:
        # Mark as cancelled
        supabase.table("bookings").update({"status": "cancelled"}).eq("id", booking_id).execute()
        raise HTTPException(status_code=400, detail="Booking lock expired. Please select a cycle again.")
        
    # Mark as active (paid)
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        update_response = supabase.table("bookings")\
            .update({
                "status": "active",
                "payment_completed_at": now.isoformat()
            })\
            .eq("id", booking_id)\
            .execute()
            
        if not update_response.data:
            raise HTTPException(status_code=500, detail="Failed to update booking status.")
            
        # Send confirmation email
        send_confirmation_email(
            user_email=booking["user_email"],
            cycle_name=booking["cycle_name"],
            duration_minutes=booking["duration_minutes"],
            otp=booking["otp"]
        )
        
        return update_response.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process payment: {str(e)}")

@app.post("/api/bookings/{booking_id}/complete")
def complete_booking(booking_id: str):
    try:
        update_response = supabase.table("bookings")\
            .update({"status": "completed"})\
            .eq("id", booking_id)\
            .execute()
        if not update_response.data:
            raise HTTPException(status_code=404, detail="Booking not found.")
        return {"success": True, "message": "Booking completed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
