import os
import sys
import io

# Force stdout/stderr to be UTF-8 encoding to avoid Windows charmap encoding errors
if hasattr(sys.stdout, 'buffer'):
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
    except Exception:
        pass

import json
import urllib.request
import tempfile
import cv2
import numpy as np
import subprocess
from PIL import Image, ImageDraw, ImageFont

def get_system_font(size):
    """Find a standard TrueType font that supports CJK and Vietnamese characters."""
    font_paths = [
        "C:\\Windows\\Fonts\\segoeui.ttf",     # Windows Segoe UI (highly unicode compatible)
        "C:\\Windows\\Fonts\\arial.ttf",       # Windows Arial
        "C:\\Windows\\Fonts\\calibri.ttf",     # Windows Calibri
        "C:\\Windows\\Fonts\\tahoma.ttf",      # Windows Tahoma
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux DejaVu
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"  # Linux Liberation
    ]
    for path in font_paths:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except:
                pass
    return ImageFont.load_default()

def wrap_text(text, font, max_width, draw):
    """Wrap text to fit within max_width. Supports spacing-based and CJK spacing-free languages."""
    if not text:
        return []
    
    # If the text has spaces, wrap by word
    if ' ' in text:
        words = text.split(' ')
        lines = []
        current_line = []
        for word in words:
            current_line.append(word)
            test_str = ' '.join(current_line)
            bbox = draw.textbbox((0, 0), test_str, font=font)
            w = bbox[2] - bbox[0]
            if w > max_width:
                if len(current_line) > 1:
                    current_line.pop()
                    lines.append(' '.join(current_line))
                    current_line = [word]
                else:
                    lines.append(test_str)
                    current_line = []
        if current_line:
            lines.append(' '.join(current_line))
        return lines
    else:
        # Wrap character-by-character (for CJK / continuous text strings)
        lines = []
        current_line = ""
        for char in text:
            test_str = current_line + char
            bbox = draw.textbbox((0, 0), test_str, font=font)
            w = bbox[2] - bbox[0]
            if w > max_width:
                if current_line:
                    lines.append(current_line)
                    current_line = char
                else:
                    lines.append(test_str)
                    current_line = ""
            else:
                current_line = test_str
        if current_line:
            lines.append(current_line)
        return lines

def make_gradient_background(w, h, frame_idx, total_frames):
    """Generate a slowly waving background gradient for visual aesthetics."""
    t = frame_idx / max(1, total_frames - 1)
    shift = int(50 * np.sin(2 * np.pi * t))
    
    # Base BGR colors
    color1 = np.array([235, 180, 100])  # Soft gold/orange
    color2 = np.array([120, 40, 180])   # Royal purple
    
    grid = np.linspace(0, 1, w)
    grid = np.roll(grid, shift)
    
    gradient_line = np.outer(grid, color2) + np.outer(1 - grid, color1)
    gradient_line = gradient_line.astype(np.uint8).reshape((1, w, 3))
    
    frame = np.repeat(gradient_line, h, axis=0)
    return frame

def generate_fallback_frame(w, h, frame_idx, total_frames, shot_id, action, environment):
    """Draw a dynamic premium information card if video/image assets are offline or mock."""
    frame = make_gradient_background(w, h, frame_idx, total_frames)
    
    # Convert to PIL
    pil_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_img, "RGBA")
    
    font_large = get_system_font(40)
    font_small = get_system_font(24)
    
    # Draw subtle background vignette
    draw.rectangle([20, 20, w - 20, h - 20], outline=(255, 255, 255, 40), width=2)
    
    # Draw shot info
    text_shot = f"🎬 {shot_id}"
    draw.text((60, 60), text_shot, font=font_large, fill=(255, 255, 255, 255))
    
    text_env = f"📍 Location: {environment}"
    draw.text((60, 130), text_env, font=font_small, fill=(230, 230, 255, 255))
    
    # Draw action
    text_action = f"📝 Action: {action}"
    action_lines = wrap_text(text_action, font_small, int(w * 0.85), draw)
    y_offset = 180
    for line in action_lines:
        draw.text((60, y_offset), line, font=font_small, fill=(200, 200, 230, 255))
        y_offset += 35
        
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

def apply_camera_movement(img, frame_idx, total_frames, movement_type, target_w, target_h):
    """Simulate camera zoom/pan (Ken Burns effect) using bicubic interpolation."""
    h, w = img.shape[:2]
    movement = movement_type.lower()
    
    scale = 1.0
    t = frame_idx / max(1, total_frames - 1)
    
    if "zoom in" in movement:
        scale = 1.0 + 0.12 * t
    elif "zoom out" in movement:
        scale = 1.12 - 0.12 * t
    
    crop_w = int(w / scale)
    crop_h = int(h / scale)
    
    max_dx = (w - crop_w) // 2
    max_dy = (h - crop_h) // 2
    
    cx = w // 2
    cy = h // 2
    
    if "left" in movement:
        cx += int(max_dx * (1.0 - 2.0 * t))
    elif "right" in movement:
        cx += int(max_dx * (-1.0 + 2.0 * t))
        
    if "up" in movement:
        cy += int(max_dy * (-1.0 + 2.0 * t))
    elif "down" in movement:
        cy += int(max_dy * (1.0 - 2.0 * t))
        
    x1 = max(0, cx - crop_w // 2)
    y1 = max(0, cy - crop_h // 2)
    x2 = min(w, x1 + crop_w)
    y2 = min(h, y1 + crop_h)
    
    crop = img[y1:y2, x1:x2]
    resized = cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
    return resized

def download_resource(url, temp_dir):
    """Download web resource to local temp cache, or returns local file path if valid."""
    if not url:
        return None
    if not url.startswith("http://") and not url.startswith("https://"):
        if os.path.exists(url):
            return url
        return None
        
    import hashlib
    url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()
    # Deduce extension
    ext = ".mp4" if ".mp4" in url.lower() or "video" in url.lower() else ".png"
    local_path = os.path.join(temp_dir, f"{url_hash}{ext}")
    
    if os.path.exists(local_path):
        return local_path
        
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=12) as response, open(local_path, 'wb') as out_file:
            out_file.write(response.read())
        return local_path
    except Exception as e:
        print(f"Error caching resource {url}: {e}", file=sys.stderr)
        return None

def prepare_shot_audio(video_path, duration, out_wav_path):
    """Extract audio from video segment and trim/pad to duration, or generate silence if video has no audio."""
    has_audio = False
    if video_path and os.path.exists(video_path):
        try:
            cmd = [
                'ffprobe', '-v', 'error', '-select_streams', 'a',
                '-show_entries', 'stream=codec_name',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                video_path
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode == 0 and res.stdout.strip():
                has_audio = True
        except Exception:
            pass

    if has_audio:
        cmd = [
            'ffmpeg', '-y', '-i', video_path, '-vn',
            '-filter_complex', f'aresample=async=1,atrim=0:{duration},apad=whole_dur={duration}',
            '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', out_wav_path
        ]
    else:
        cmd = [
            'ffmpeg', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
            '-t', str(duration), '-c:a', 'pcm_s16le', out_wav_path
        ]
        
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return True
    except Exception as e:
        print(f"Error preparing audio for {video_path}: {e}", file=sys.stderr)
        try:
            cmd_fallback = [
                'ffmpeg', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
                '-t', str(duration), '-c:a', 'pcm_s16le', out_wav_path
            ]
            subprocess.run(cmd_fallback, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            return True
        except:
            return False

def check_nvenc_support():
    """Verify if NVIDIA NVENC is supported by running a fast encoding dry-run."""
    try:
        cmd = [
            'ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1',
            '-vcodec', 'h264_nvenc', '-f', 'null', '-'
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=4)
        return res.returncode == 0
    except Exception:
        return False

def main():
    import argparse
    parser = argparse.ArgumentParser(description="AI Kids Animation Studio MP4 Video Exporter")
    parser.add_argument("--config", required=True, help="Path to input configuration JSON file")
    parser.add_argument("--output", required=True, help="Output target MP4 file path")
    parser.add_argument("--width", type=int, default=1280, help="Output video width")
    parser.add_argument("--height", type=int, default=720, help="Output video height")
    args = parser.parse_args()

    # Load configuration
    try:
        with open(args.config, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception as e:
        print(f"Error reading configuration file: {e}", file=sys.stderr)
        sys.exit(1)

    shots = config.get("shots", [])
    keyframes = config.get("keyframes", [])
    motion_prompts = config.get("motion_prompts", [])
    
    if not shots:
        print("Error: No shots found in configuration", file=sys.stderr)
        sys.exit(1)

    fps = 30
    temp_dir = tempfile.mkdtemp(prefix="video_render_")
    
    # Calculate total frame budget
    total_frames = 0
    shot_frame_budgets = []
    for shot in shots:
        dur = shot.get("duration_seconds") or 5
        frames_budget = int(dur * fps)
        shot_frame_budgets.append(frames_budget)
        total_frames += frames_budget

    print(f"Starting compilation. Total duration: {total_frames / fps:.1f}s | {total_frames} frames", flush=True)

    # Pre-pass: Download assets and prepare audio tracks
    print("Preparing assets and audio tracks...", flush=True)
    shot_wav_paths = []
    cached_videos = {}
    cached_images = {}

    for idx, shot in enumerate(shots):
        shot_id = shot.get("shot_id")
        duration = shot.get("duration_seconds") or 5
        
        # Find keyframe and video url
        kf_obj = next((k for k in keyframes if k.get("shot_id") == shot_id), None)
        mp_obj = next((m for m in motion_prompts if m.get("shot_id") == shot_id), None)

        video_url = mp_obj.get("video_url") if mp_obj else None
        image_url = kf_obj.get("url") if kf_obj else None

        # Resolve to cached file path
        video_local = download_resource(video_url, temp_dir) if video_url else None
        image_local = download_resource(image_url, temp_dir) if image_url else None

        cached_videos[shot_id] = video_local
        cached_images[shot_id] = image_local

        # Prepare audio wav for this shot
        wav_path = os.path.join(temp_dir, f"audio_{shot_id}.wav")
        prepare_shot_audio(video_local, duration, wav_path)
        shot_wav_paths.append(wav_path)
        
        print(f"Prepared audio and assets for shot {shot_id}", flush=True)

    # Concatenate all audio WAVs
    master_wav_path = os.path.join(temp_dir, "master_audio.wav")
    has_audio_track = False
    try:
        concat_list_path = os.path.join(temp_dir, "audio_concat_list.txt")
        with open(concat_list_path, "w", encoding="utf-8") as f:
            for wav_path in shot_wav_paths:
                f.write(f"file '{wav_path.replace(os.sep, '/')}'\n")
        
        concat_cmd = [
            'ffmpeg', '-y', '-f', 'concat', '-safe', '0',
            '-i', concat_list_path, '-c', 'copy', master_wav_path
        ]
        res = subprocess.run(concat_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode == 0 and os.path.exists(master_wav_path):
            has_audio_track = True
            print("Successfully compiled master audio track.", flush=True)
    except Exception as e:
        print(f"Error compiling master audio track: {e}", file=sys.stderr)

    # Detect NVENC support
    has_nvenc = check_nvenc_support()
    
    if has_audio_track:
        if has_nvenc:
            print("GPU Hardware Acceleration Detected (h264_nvenc). Optimizing rendering speed...", flush=True)
            ffmpeg_cmd = [
                'ffmpeg', '-y',
                '-f', 'rawvideo', '-vcodec', 'rawvideo',
                '-pix_fmt', 'bgr24', '-s', f'{args.width}x{args.height}', '-r', str(fps),
                '-i', '-',  # Input 0: video from stdin
                '-i', master_wav_path,  # Input 1: audio from WAV file
                '-vcodec', 'h264_nvenc', '-acodec', 'aac',
                '-map', '0:v:0', '-map', '1:a:0',
                '-pix_fmt', 'yuv420p',
                '-preset', 'fast', '-b:v', '5M', args.output
            ]
        else:
            print("GPU NVENC not available. Falling back to multi-threaded CPU rendering (libx264)...", flush=True)
            ffmpeg_cmd = [
                'ffmpeg', '-y',
                '-f', 'rawvideo', '-vcodec', 'rawvideo',
                '-pix_fmt', 'bgr24', '-s', f'{args.width}x{args.height}', '-r', str(fps),
                '-i', '-',  # Input 0: video from stdin
                '-i', master_wav_path,  # Input 1: audio from WAV file
                '-vcodec', 'libx264', '-acodec', 'aac',
                '-map', '0:v:0', '-map', '1:a:0',
                '-pix_fmt', 'yuv420p',
                '-preset', 'medium', '-crf', '21', '-threads', '0', args.output
            ]
    else:
        # Fallback without audio
        if has_nvenc:
            print("GPU Hardware Acceleration Detected (h264_nvenc). Optimizing rendering speed (no audio)...", flush=True)
            ffmpeg_cmd = [
                'ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo',
                '-pix_fmt', 'bgr24', '-s', f'{args.width}x{args.height}', '-r', str(fps),
                '-i', '-', '-vcodec', 'h264_nvenc', '-pix_fmt', 'yuv420p',
                '-preset', 'fast', '-b:v', '5M', args.output
            ]
        else:
            print("GPU NVENC not available. Falling back to multi-threaded CPU rendering (libx264) (no audio)...", flush=True)
            ffmpeg_cmd = [
                'ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo',
                '-pix_fmt', 'bgr24', '-s', f'{args.width}x{args.height}', '-r', str(fps),
                '-i', '-', '-vcodec', 'libx264', '-pix_fmt', 'yuv420p',
                '-preset', 'medium', '-crf', '21', '-threads', '0', args.output
            ]

    # Spawn FFmpeg
    try:
        ffmpeg_proc = subprocess.Popen(
            ffmpeg_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
    except Exception as e:
        print(f"Error spawning FFmpeg: {e}", file=sys.stderr)
        sys.exit(1)

    # Compile frames
    current_global_frame = 0
    font_subtitle = get_system_font(28)

    for idx, shot in enumerate(shots):
        shot_id = shot.get("shot_id")
        duration = shot.get("duration_seconds") or 5
        budget = shot_frame_budgets[idx]
        camera_movement = shot.get("camera_movement") or "Static"
        action = shot.get("actions") or ""
        environment = shot.get("environment") or ""
        dialogues = shot.get("dialogue", [])

        # Retrieve cached asset paths
        video_local = cached_videos.get(shot_id)
        image_local = cached_images.get(shot_id)

        # Load source frames
        source_frames = []
        
        # Scenario A: We have a video segment
        if video_local:
            try:
                cap = cv2.VideoCapture(video_local)
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    # Pre-resize frame to speed up memory processing
                    frame_res = cv2.resize(frame, (args.width, args.height), interpolation=cv2.INTER_LINEAR)
                    source_frames.append(frame_res)
                cap.release()
            except Exception as e:
                print(f"Error reading video {video_local}: {e}", file=sys.stderr)

        # Scenario B: We have a keyframe image
        if not source_frames and image_local:
            try:
                img = cv2.imread(image_local)
                if img is not None:
                    # Apply Ken Burns effect dynamically per frame
                    for f_i in range(budget):
                        source_frames.append(
                            apply_camera_movement(img, f_i, budget, camera_movement, args.width, args.height)
                        )
            except Exception as e:
                print(f"Error reading image {image_local}: {e}", file=sys.stderr)

        for f_i in range(budget):
            if len(source_frames) > 0:
                if duration < 8:
                    # Play at normal 1-to-1 speed. Trim if shot is shorter, freeze if source is shorter.
                    if f_i < len(source_frames):
                        frame = source_frames[f_i].copy()
                    else:
                        frame = source_frames[-1].copy()
                else:
                    # For shots >= 8s, loop at normal speed to fill duration without speeding up
                    frame = source_frames[f_i % len(source_frames)].copy()
            else:
                # Scenario C: Fallback animated graphic card
                frame = generate_fallback_frame(
                    args.width, args.height, f_i, budget, shot_id, action, environment
                )

            # Dialogue Overlay (Subtitles)
            if dialogues:
                # Divide time evenly among dialogue phrases
                d_idx = int((f_i / budget) * len(dialogues))
                d_item = dialogues[min(d_idx, len(dialogues) - 1)]
                speaker = d_item.get("character") or "AI"
                speech = d_item.get("speech") or ""
                
                # Render subtitle
                pil_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                draw = ImageDraw.Draw(pil_img, "RGBA")
                
                # Wrap text to 85% of screen width
                wrapped_lines = wrap_text(f"{speaker}: \"{speech}\"", font_subtitle, int(args.width * 0.85), draw)
                
                if wrapped_lines:
                    line_height = 36
                    box_height = len(wrapped_lines) * line_height + 24
                    
                    # Draw semi-transparent rectangle box
                    box_y1 = args.height - box_height - 35
                    box_y2 = args.height - 35
                    draw.rectangle(
                        [int(args.width * 0.07), box_y1, int(args.width * 0.93), box_y2],
                        fill=(0, 0, 0, 185), outline=(255, 255, 255, 15), width=1
                    )
                    
                    # Draw each line centered
                    for l_idx, line in enumerate(wrapped_lines):
                        line_w = draw.textbbox((0, 0), line, font=font_subtitle)[2]
                        tx = (args.width - line_w) // 2
                        ty = box_y1 + 12 + l_idx * line_height
                        
                        # Draw speaker name in accent yellow and dialog text in white
                        if line.startswith(f"{speaker}:"):
                            # Draw speaker prefix
                            prefix = f"{speaker}: "
                            prefix_w = draw.textbbox((0, 0), prefix, font=font_subtitle)[2]
                            
                            # Draw name
                            draw.text((tx, ty), prefix, font=font_subtitle, fill=(253, 224, 71, 255)) # Yellow
                            # Draw text
                            dialog_text = line[len(prefix):]
                            draw.text((tx + prefix_w, ty), dialog_text, font=font_subtitle, fill=(255, 255, 255, 255))
                        else:
                            draw.text((tx, ty), line, font=font_subtitle, fill=(255, 255, 255, 255))
                
                frame = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

            # Write frame to FFmpeg pipe
            try:
                ffmpeg_proc.stdin.write(frame.tobytes())
            except IOError as err:
                print(f"FFmpeg pipe broken at frame {current_global_frame}: {err}", file=sys.stderr)
                break

            current_global_frame += 1
            if total_frames > 0:
                percent = int((current_global_frame / total_frames) * 100)
                # Flush stdout so client reads progress instantly
                print(f"PROGRESS:{percent}", flush=True)

    # Close FFmpeg pipe
    try:
        ffmpeg_proc.stdin.close()
        stdout, stderr = ffmpeg_proc.communicate()
        if ffmpeg_proc.returncode != 0:
            print(f"FFmpeg failed with code {ffmpeg_proc.returncode}.", file=sys.stderr)
            print(f"FFmpeg stderr: {stderr.decode(errors='replace')}", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"Error wrapping up FFmpeg: {e}", file=sys.stderr)
        sys.exit(1)

    # Clean up temp cache
    try:
        for f in os.listdir(temp_dir):
            os.remove(os.path.join(temp_dir, f))
        os.rmdir(temp_dir)
    except:
        pass

    print("SUCCESS: Render complete!", flush=True)

if __name__ == "__main__":
    main()
