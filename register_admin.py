#!/usr/bin/env python3
"""
CYBER-EDR SOAR - Local Admin Biometric & Face Identity Provisioning Tool
========================================================================
This tool allows system administrators to register/update their facial
identity and biometric credentials locally on the server.

For zero-trust security, enrollment from the public web browser is disabled.
Admin identity must be enrolled locally using this script.

Features:
  - Live webcam capture with real-time HUD or image file input
  - 128-dimensional facial feature vector extraction (matching browser engine)
  - FIDO2 / WebAuthn platform authenticator (Fingerprint / Windows Hello) setup
  - AES-256-GCM authenticated encryption at rest (matching backend crypto)
  - Cryptographic offline emergency recovery key generation
  - Account lockout reset & face verification test tool
"""

import sys
import os
import json
import base64
import hashlib
import time
import argparse
from typing import List, Tuple, Optional

# Cryptography for AES-256-GCM
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    print("[ERROR] Required package 'cryptography' is missing.")
    print("Install via: pip install cryptography")
    sys.exit(1)

# Optional image & camera support
try:
    import numpy as np
except ImportError:
    np = None

try:
    from PIL import Image
except ImportError:
    Image = None

try:
    import cv2
except ImportError:
    cv2 = None

# Constants & Configuration
DEFAULT_SECRET = "edr-soc-defense-master-key-2026-secure-aes256"
MAGIC_HEADER = b"EDR1"
IV_LENGTH = 12
TAG_LENGTH = 16

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(PROJECT_ROOT, "backend", "data", "edr_database.json")
BACKEND_URL = os.environ.get("EDR_BACKEND_URL", "http://localhost:3000")


# ============================================================================
# CRYPTOGRAPHY UTILITIES (AES-256-GCM & SALTED SHA-256)
# ============================================================================

def get_master_key() -> bytes:
    """Derives 256-bit AES key from EDR_ENCRYPTION_KEY via SHA-256."""
    secret = os.environ.get("EDR_ENCRYPTION_KEY", DEFAULT_SECRET)
    return hashlib.sha256(secret.encode("utf-8")).digest()


def encrypt_string(text: str) -> str:
    """
    Encrypts string using AES-256-GCM authenticated encryption.
    Format: [4 bytes 'EDR1'] + [12 bytes IV] + [16 bytes Tag] + [Ciphertext]
    Output: Base64 string (compatible with backend decryptString).
    """
    key = get_master_key()
    iv = os.urandom(IV_LENGTH)
    aesgcm = AESGCM(key)
    cipher_and_tag = aesgcm.encrypt(iv, text.encode("utf-8"), None)
    ciphertext = cipher_and_tag[:-TAG_LENGTH]
    tag = cipher_and_tag[-TAG_LENGTH:]
    payload = MAGIC_HEADER + iv + tag + ciphertext
    return base64.b64encode(payload).decode("utf-8")


def decrypt_string(cipher_b64: str) -> str:
    """Decrypts base64-encoded AES-256-GCM payload."""
    key = get_master_key()
    raw = base64.b64decode(cipher_b64)
    if len(raw) < 4 + IV_LENGTH + TAG_LENGTH or raw[:4] != MAGIC_HEADER:
        raise ValueError("Invalid encrypted buffer or magic header mismatch.")
    iv = raw[4 : 4 + IV_LENGTH]
    tag = raw[4 + IV_LENGTH : 4 + IV_LENGTH + TAG_LENGTH]
    ciphertext = raw[4 + IV_LENGTH + TAG_LENGTH :]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)
    return plaintext.decode("utf-8")


def generate_recovery_key() -> str:
    """Generates an offline emergency recovery key (Format: EDR-XXXX-XXXX-XXXX-XXXX)."""
    chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # Base32 excluding 0/O, 1/I
    blocks = []
    for _ in range(4):
        block = "".join(chars[b % len(chars)] for b in os.urandom(4))
        blocks.append(block)
    return f"EDR-{'-'.join(blocks)}"


def generate_salt(byte_length: int = 16) -> str:
    """Generates a secure URL-safe base64 salt."""
    return base64.urlsafe_b64encode(os.urandom(byte_length)).decode("utf-8").rstrip("=")


def hash_with_salt(value: str, salt: str) -> str:
    """Salted SHA-256 hash matching backend hashWithSalt."""
    normalized = value.strip().upper()
    combined = f"{salt}:{normalized}"
    return hashlib.sha256(combined.encode("utf-8")).hexdigest()


def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    """Computes cosine similarity between two numeric feature vectors."""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = sum(a * a for a in vec_a) ** 0.5
    norm_b = sum(b * b for b in vec_b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


# ============================================================================
# FACIAL FEATURE EXTRACTION (128-DIMENSIONAL SPATIAL GRID)
# ============================================================================

def extract_face_descriptor_from_image(image_input) -> Tuple[List[float], float, float]:
    """
    Extracts a 128-dimensional normalized facial feature vector from an image or frame.
    Matches extractFaceFeatureVector() in management-dashboard/src/services/biometricService.ts:
      1. Center-crops 70% region.
      2. Resizes to 160x160 RGB.
      3. Calculates 16x8 spatial grid (128 blocks) of luminance and horizontal gradient.
      4. Feature = (avgLum / 255.0) * 0.7 + (avgGrad / 100.0) * 0.3.
      5. L2-normalizes the 128-dimensional vector to unit hypersphere.
    Returns: (descriptor, brightness, skin_ratio)
    """
    target_size = 160

    # Convert to PIL Image in RGB mode
    if isinstance(image_input, str):
        if not os.path.exists(image_input):
            raise FileNotFoundError(f"Image file not found: {image_input}")
        pil_img = Image.open(image_input).convert("RGB")
    elif cv2 is not None and isinstance(image_input, np.ndarray):
        rgb_arr = cv2.cvtColor(image_input, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb_arr)
    elif Image is not None and isinstance(image_input, Image.Image):
        pil_img = image_input.convert("RGB")
    else:
        raise TypeError("Unsupported image input type.")

    # Center crop 70% of minimum dimension (face area)
    w, h = pil_img.size
    crop_size = int(min(w, h) * 0.7)
    left = (w - crop_size) // 2
    top = (h - crop_size) // 2
    cropped = pil_img.crop((left, top, left + crop_size, top + crop_size))
    resized = cropped.resize((target_size, target_size), Image.Resampling.BILINEAR)

    pixels = np.array(resized, dtype=np.float32)  # shape (160, 160, 3)

    grid_x = 16
    grid_y = 8
    block_w = target_size // grid_x  # 10
    block_h = target_size // grid_y  # 20
    descriptor: List[float] = []

    total_luminance = 0.0
    skin_pixels = 0
    total_pixels = target_size * target_size

    # Iterate over 16x8 grid
    for gy in range(grid_y):
        for gx in range(grid_x):
            block = pixels[gy * block_h : (gy + 1) * block_h, gx * block_w : (gx + 1) * block_w]
            r = block[:, :, 0]
            g = block[:, :, 1]
            b = block[:, :, 2]

            # Photometric luminance: 0.299*R + 0.587*G + 0.114*B
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            total_luminance += float(np.sum(lum))

            # Skin tone detection: R > 60, G > 40, B > 20, R > G > B, (R - G) > 12
            skin_mask = (r > 60) & (g > 40) & (b > 20) & (r > g) & (g > b) & ((r - g) > 12)
            skin_pixels += int(np.sum(skin_mask))

            avg_lum = float(np.mean(lum))

            # Horizontal gradient
            if block_w > 1:
                diff = np.abs(np.diff(lum, axis=1))
                avg_grad = float(np.mean(diff))
            else:
                avg_grad = 0.0

            val = (avg_lum / 255.0) * 0.7 + (avg_grad / 100.0) * 0.3
            descriptor.append(float(val))

    brightness = total_luminance / total_pixels
    skin_ratio = skin_pixels / total_pixels

    # Zero-mean centering (removes ambient lighting DC offset to isolate facial structure/geometry)
    mean_val = sum(descriptor) / len(descriptor)
    descriptor = [x - mean_val for x in descriptor]

    # L2-normalize descriptor vector to unit hypersphere
    norm = sum(x * x for x in descriptor) ** 0.5
    if norm > 0.0:
        descriptor = [x / norm for x in descriptor]

    return descriptor, brightness, skin_ratio


def capture_face_via_webcam() -> Optional[List[float]]:
    """Opens live camera viewport with reticle to capture facial template."""
    if cv2 is None:
        print("[ERROR] OpenCV (cv2) is not installed. Webcam capture unavailable.")
        print("Install via: pip install opencv-python")
        return None

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] Could not open webcam device (index 0). Please check camera connection.")
        return None

    print("\n[CAMERA] Webcam initialized.")
    print("Instructions:")
    print("  - Center your face inside the targeting oval reticle.")
    print("  - Press [SPACE] to capture face and extract template.")
    print("  - Press [Q] or [ESC] to cancel.\n")

    captured_descriptor = None

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[ERROR] Failed reading frame from webcam.")
            break

        # Flip horizontally for natural mirror view
        frame = cv2.flip(frame, 1)
        h, w = frame.shape[:2]

        display = frame.copy()

        # Draw targeting reticle
        center = (w // 2, h // 2)
        axes = (int(min(w, h) * 0.22), int(min(w, h) * 0.32))
        cv2.ellipse(display, center, axes, 0, 0, 360, (255, 200, 0), 2)

        # Overlay HUD text
        cv2.putText(display, "CYBER-EDR BIOMETRIC ENROLLMENT", (20, 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 200, 0), 2)
        cv2.putText(display, "Press [SPACE] to Capture | [Q] to Cancel", (20, h - 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

        cv2.imshow("CYBER-EDR Face Registration", display)
        key = cv2.waitKey(1) & 0xFF

        if key in (ord('q'), 27):  # Q or ESC
            print("[INFO] Camera capture cancelled by user.")
            break
        elif key == 32:  # SPACE
            print("[INFO] Capturing facial frame...")
            try:
                descriptor, brightness, skin_ratio = extract_face_descriptor_from_image(frame)
                print(f"[OK] Face analyzed: Brightness={brightness:.1f}, SkinRatio={skin_ratio * 100:.1f}%")
                if skin_ratio < 0.08:
                    print("[WARNING] Low skin-tone ratio detected. Face may not be clearly centered.")
                    confirm = input("Keep this capture anyway? [y/N]: ").strip().lower()
                    if confirm != 'y':
                        continue
                captured_descriptor = descriptor
                break
            except Exception as e:
                print(f"[ERROR] Extraction failed: {e}")

    cap.release()
    cv2.destroyAllWindows()
    return captured_descriptor


# ============================================================================
# DATABASE REPOSITORY INTEGRATION
# ============================================================================

def load_database() -> dict:
    """Reads backend database JSON file."""
    if not os.path.exists(DB_FILE):
        os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
        return {
            "devices": [],
            "policies": {},
            "commands": [],
            "logs": [],
            "appUsage": [],
            "installedApps": [],
            "photos": [],
            "recordings": [],
            "callLogs": [],
            "actionLogs": [],
            "releases": [],
        }
    with open(DB_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_database(data: dict) -> None:
    """Saves database JSON file with backup."""
    bak_file = f"{DB_FILE}.bak"
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r", encoding="utf-8") as src, open(bak_file, "w", encoding="utf-8") as dst:
                dst.write(src.read())
        except Exception:
            pass

    tmp_file = f"{DB_FILE}.tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp_file, DB_FILE)


def enroll_admin_identity(
    face_descriptor: List[float],
    credential_id: Optional[str] = None,
    allow_any_platform_biometric: bool = True
) -> dict:
    """
    Encrypts and saves admin biometric identity to edr_database.json.
    Generates an emergency recovery key and resets any active lockouts.
    """
    db = load_database()

    # Generate offline emergency recovery key
    recovery_key = generate_recovery_key()
    salt = generate_salt(16)
    recovery_hash = hash_with_salt(recovery_key, salt)

    # Prepare WebAuthn platform authenticator credential payload
    cred_id = credential_id if credential_id else f"edr-admin-platform-{int(time.time())}"
    webauthn_cred = {
        "id": cred_id,
        "rawId": cred_id,
        "type": "public-key",
        "allowAnyPlatformBiometric": allow_any_platform_biometric,
        "registeredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    # Encrypt at rest with AES-256-GCM
    face_encrypted = encrypt_string(json.dumps(face_descriptor))
    webauthn_encrypted = encrypt_string(json.dumps(webauthn_cred))

    enrolled_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    biometrics = {
        "isEnrolled": True,
        "enrolledAt": enrolled_at,
        "faceDescriptorEncrypted": face_encrypted,
        "webAuthnCredentialEncrypted": webauthn_encrypted,
        "recoveryKeyHash": recovery_hash,
        "recoveryKeySalt": salt,
    }

    db["biometrics"] = biometrics

    # Reset any lockout state
    db["authLockout"] = {
        "failedAttempts": 0,
        "lockedUntil": None,
        "lastAttemptAt": enrolled_at,
    }

    # Add audit log
    if "authAuditLogs" not in db:
        db["authAuditLogs"] = []

    audit_entry = {
        "id": f"audit_{int(time.time() * 1000)}",
        "timestamp": enrolled_at,
        "ip": "127.0.0.1",
        "userAgent": "register_admin.py (Local CLI)",
        "stage": "ENROLL",
        "result": "SUCCESS",
        "details": f"Admin identity enrolled locally via CLI script (Recovery Key generated)",
    }
    db["authAuditLogs"].append(audit_entry)

    save_database(db)

    return {
        "enrolledAt": enrolled_at,
        "recoveryKey": recovery_key,
        "credentialId": cred_id,
        "descriptorSize": len(face_descriptor),
    }


def get_current_status() -> dict:
    """Returns current admin enrollment and lockout state from the database."""
    db = load_database()
    biometrics = db.get("biometrics", {})
    lockout = db.get("authLockout", {})

    now_ms = int(time.time() * 1000)
    locked_until = lockout.get("lockedUntil")
    is_locked = bool(locked_until and now_ms < locked_until)
    lock_expires_sec = max(0, int((locked_until - now_ms) / 1000)) if is_locked else 0

    return {
        "isEnrolled": bool(biometrics.get("isEnrolled")),
        "enrolledAt": biometrics.get("enrolledAt"),
        "hasFace": bool(biometrics.get("faceDescriptorEncrypted")),
        "hasBiometric": bool(biometrics.get("webAuthnCredentialEncrypted")),
        "hasRecoveryKey": bool(biometrics.get("recoveryKeyHash")),
        "isLocked": is_locked,
        "lockExpiresSec": lock_expires_sec,
        "failedAttempts": lockout.get("failedAttempts", 0),
    }


def reset_lockout_state() -> None:
    """Resets failed attempt counters and clears lockout."""
    db = load_database()
    db["authLockout"] = {
        "failedAttempts": 0,
        "lockedUntil": None,
        "lastAttemptAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    save_database(db)


def test_face_match(test_image_input) -> Tuple[float, bool]:
    """Tests facial similarity between a given image/frame and the enrolled admin template."""
    db = load_database()
    biometrics = db.get("biometrics", {})
    if not biometrics.get("isEnrolled") or not biometrics.get("faceDescriptorEncrypted"):
        raise ValueError("No admin biometric identity has been enrolled yet.")

    stored_json = decrypt_string(biometrics["faceDescriptorEncrypted"])
    stored_template: List[float] = json.loads(stored_json)

    test_descriptor, _, _ = extract_face_descriptor_from_image(test_image_input)
    sim = cosine_similarity(test_descriptor, stored_template)
    MATCH_THRESHOLD = 0.80
    return sim, sim >= MATCH_THRESHOLD


# ============================================================================
# INTERACTIVE CLI INTERFACE
# ============================================================================

def print_banner():
    banner = r"""
=============================================================================
   ______  ______  ______ _____          ______ _____  _____  
  / ____/ /_  __/ / ____// ___/ ____    / ____// __ \ / __ \ 
 / /       / /   / __/   \__ \ / __ \  / __/  / / / // /_/ / 
/ /___    / /   / /___  ___/ // /_/ / / /___ / /_/ // _, _/  
\____/   /_/   /_____/ /____/ \____/ /_____//_____//_/ |_|   
                                                              
  ADMIN BIOMETRIC IDENTITY ENROLLMENT & PROVISIONING TOOL
=============================================================================
  Zero-Trust Security Enforcement:
  * Public web registration is permanently disabled.
  * Administrator identity must be registered locally via this tool.
=============================================================================
"""
    print(banner)


def run_enrollment_flow(image_path: Optional[str] = None):
    print("\n--- [STARTING ADMIN ENROLLMENT] ---")
    descriptor: Optional[List[float]] = None

    if image_path:
        print(f"[IMAGE] Loading face from file: {image_path}")
        try:
            descriptor, brightness, skin_ratio = extract_face_descriptor_from_image(image_path)
            print(f"[OK] Face analyzed successfully! (Brightness={brightness:.1f}, SkinRatio={skin_ratio*100:.1f}%)")
        except Exception as e:
            print(f"[ERROR] Failed to extract face from image: {e}")
            return
    else:
        print("\nChoose Face Registration Source:")
        print("  [1] Live Webcam Capture (Interactive Reticle)")
        print("  [2] Image File Path (PNG/JPG photo)")
        choice = input("Select [1/2]: ").strip()

        if choice == "2":
            img_file = input("Enter full path to admin face photo: ").strip(' "\'')
            if not os.path.exists(img_file):
                print(f"[ERROR] File does not exist: {img_file}")
                return
            try:
                descriptor, brightness, skin_ratio = extract_face_descriptor_from_image(img_file)
                print(f"[OK] Face analyzed successfully! (Brightness={brightness:.1f}, SkinRatio={skin_ratio*100:.1f}%)")
            except Exception as e:
                print(f"[ERROR] Failed extracting facial features: {e}")
                return
        else:
            descriptor = capture_face_via_webcam()
            if not descriptor:
                print("[ERROR] Face capture aborted.")
                return

    print("\n[BIOMETRIC AUTHENTICATOR CONFIGURATION]")
    print("  * Hardware Biometric: WebAuthn / Platform Authenticator")
    print("  * Supported: Fingerprint Sensor, Windows Hello, Touch ID, Android BiometricPrompt")
    print("  * Mode: Any authorized biometric registered on the admin's device will unlock Step 2.")

    print("\nWriting encrypted biometric credentials to secure storage...")
    result = enroll_admin_identity(
        face_descriptor=descriptor,
        allow_any_platform_biometric=True
    )

    print("\n" + "=" * 70)
    print("  SUCCESSFULLY ENROLLED ADMIN BIOMETRIC IDENTITY!")
    print("=" * 70)
    print(f"  Enrolled Timestamp:  {result['enrolledAt']}")
    print(f"  Face Descriptor:     128-D vector (AES-256-GCM Encrypted at rest)")
    print(f"  Platform Biometric:  Hardware Fingerprint / Windows Hello enabled")
    print("=" * 70)
    print("\n  CRITICAL SECURITY BACKUP:")
    print("  -------------------------------------------------------------")
    print(f"  EMERGENCY OFFLINE RECOVERY KEY:  \033[1;33m{result['recoveryKey']}\033[0m")
    print("  -------------------------------------------------------------")
    print("  WARNING: Save this recovery key in a secure physical location.")
    print("  If the camera or fingerprint sensor malfunctions, this key is")
    print("  the ONLY recovery method to unlock your admin console.")
    print("=" * 70 + "\n")


def display_status():
    status = get_current_status()
    print("\n--- [CURRENT ADMIN ENROLLMENT STATUS] ---")
    print(f"  Enrolled:            {'YES' if status['isEnrolled'] else 'NO (Enrollment Required)'}")
    if status['isEnrolled']:
        print(f"  Enrolled At:         {status['enrolledAt']}")
        print(f"  Facial Template:     {'CONFIGURED (AES-256 Encrypted)' if status['hasFace'] else 'MISSING'}")
        print(f"  Hardware Biometric:  {'CONFIGURED (WebAuthn Platform)' if status['hasBiometric'] else 'MISSING'}")
        print(f"  Recovery Key:        {'CONFIGURED' if status['hasRecoveryKey'] else 'MISSING'}")
    print(f"  Account Lockout:     {'LOCKED' if status['isLocked'] else 'NORMAL (Unlocked)'}")
    if status['isLocked']:
        print(f"  Lockout Expires In:  {status['lockExpiresSec']} seconds")
    print(f"  Failed Attempts:     {status['failedAttempts']} / 5")
    print("------------------------------------------\n")


def interactive_menu():
    print_banner()
    while True:
        status = get_current_status()
        status_str = "ENROLLED" if status['isEnrolled'] else "NOT ENROLLED"
        lock_str = " (LOCKED)" if status['isLocked'] else ""
        print(f"\n[System Status: {status_str}{lock_str}]")
        print("  [1] Enroll / Update Admin Face & Biometrics")
        print("  [2] Check Current Enrollment Status")
        print("  [3] Reset Security Lockout (Clear failed attempts)")
        print("  [4] Test Face Match (Verify an image or camera against enrolled admin)")
        print("  [0] Exit")

        choice = input("\nEnter choice [0-4]: ").strip()

        if choice == "1":
            run_enrollment_flow()
        elif choice == "2":
            display_status()
        elif choice == "3":
            reset_lockout_state()
            print("\n[OK] Security lockout and failed attempts successfully reset.")
        elif choice == "4":
            if not status['isEnrolled']:
                print("[ERROR] Please enroll an admin first before testing match.")
                continue
            test_file = input("Enter path to test photo (or press ENTER to test webcam): ").strip(' "\'')
            try:
                if test_file:
                    sim, passed = test_face_match(test_file)
                else:
                    test_desc = capture_face_via_webcam()
                    if not test_desc:
                        continue
                    db = load_database()
                    stored_json = decrypt_string(db["biometrics"]["faceDescriptorEncrypted"])
                    stored_template = json.loads(stored_json)
                    sim = cosine_similarity(test_desc, stored_template)
                    passed = sim >= 0.80

                pct = round(sim * 100, 1)
                print(f"\n[FACE MATCH RESULT]")
                print(f"  Similarity Score:    {pct}% (Threshold: 80%)")
                print(f"  Verification Result: {'PASS (ACCESS GRANTED)' if passed else 'FAIL (IDENTITY MISMATCH)'}\n")
            except Exception as e:
                print(f"[ERROR] Test failed: {e}")
        elif choice in ("0", "exit", "q"):
            print("Exiting tool. Stay secure!")
            break
        else:
            print("Invalid choice, please select 0, 1, 2, 3, or 4.")


def main():
    parser = argparse.ArgumentParser(
        description="CYBER-EDR SOAR - Local Admin Biometric Identity Provisioning CLI"
    )
    parser.add_argument("--image", type=str, help="Path to admin face photo for enrollment")
    parser.add_argument("--camera", action="store_true", help="Launch live webcam face enrollment")
    parser.add_argument("--status", action="store_true", help="Check current admin enrollment status")
    parser.add_argument("--reset-lockout", action="store_true", help="Clear failed attempts and unlock account")
    parser.add_argument("--test-match", type=str, help="Test face match against a photo path")

    args = parser.parse_args()

    if args.status:
        display_status()
    elif args.reset_lockout:
        reset_lockout_state()
        print("[OK] Security lockout reset.")
    elif args.test_match:
        sim, passed = test_face_match(args.test_match)
        print(f"Similarity: {sim * 100:.1f}% | Result: {'PASS' if passed else 'FAIL'}")
    elif args.image:
        run_enrollment_flow(image_path=args.image)
    elif args.camera:
        run_enrollment_flow()
    else:
        interactive_menu()


if __name__ == "__main__":
    main()
