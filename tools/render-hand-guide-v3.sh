#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$project_dir/outputs/handtracking-tutorial"
gameplay="$project_dir/output/playwright/paopao-v10-gameplay-desktop.png"
hands="$output_dir/hand-gestures-transparent.png"
orb="$project_dir/public/assets/sprites/v11/phoenix-green.png"
music="$project_dir/public/assets/audio/prism-pulse-game.ogg"
font_bold="/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
font_regular="/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
video="$output_dir/paopao-handtracking-double-tap-guide-v3.mp4"
poster="$output_dir/paopao-handtracking-double-tap-guide-v3-poster.jpg"
sheet="$output_dir/paopao-handtracking-double-tap-guide-v3-contact-sheet.jpg"

for required in "$gameplay" "$hands" "$orb" "$music" "$font_bold" "$font_regular"; do
  test -f "$required" || { echo "missing guide input: $required" >&2; exit 1; }
done

mkdir -p "$output_dir"
ffmpeg -hide_banner -loglevel warning -y \
  -loop 1 -t 18 -i "$gameplay" \
  -loop 1 -t 18 -i "$hands" \
  -loop 1 -t 18 -i "$orb" \
  -stream_loop -1 -i "$music" \
  -filter_complex "
    [0:v]crop=720:1280:260:0,scale=1080:1920,setsar=1,trim=duration=18,setpts=PTS-STARTPTS[base];
    [1:v]crop=610:887:0:0,scale=430:-1,format=rgba[apart];
    [1:v]crop=520:887:630:0,scale=430:-1,format=rgba[contact];
    [1:v]crop=574:887:1200:0,scale=430:-1,format=rgba[release];
    [2:v]scale=112:112,format=rgba[orb];
    [base]
      drawbox=x=0:y=0:w=1080:h=250:color=0x020817@0.94:t=fill,
      drawbox=x=38:y=32:w=1004:h=172:color=0x0A2036@0.98:t=fill,
      drawbox=x=38:y=32:w=11:h=172:color=0x56E8DC@1:t=fill,
      drawtext=fontfile=${font_bold}:text='HAND CONTROL - PINCH + RELEASE':x=(w-text_w)/2:y=60:fontsize=46:fontcolor=0xF4E9CE,
      drawtext=fontfile=${font_regular}:text='PAOPAO FUSION  •  18 SECOND GUIDE':x=(w-text_w)/2:y=142:fontsize=27:fontcolor=0x6DE9E4,
      drawbox=x=0:y=1575:w=1080:h=345:color=0x020817@0.94:t=fill[chrome];
    [chrome][apart]overlay=x=325+70*sin(t*1.7):y=1030+28*cos(t*1.4):enable='between(t,0,4.0)'[h0];
    [h0][contact]overlay=x=325+30*sin(t*1.35):y=1030+18*cos(t*1.2):enable='between(t,4.0,8.0)'[h1];
    [h1][release]overlay=x=325:y=1030+12*sin(t*4):enable='between(t,8.0,13.0)'[h2];
    [h2][orb]overlay=x=484:y=1510-(t-8.0)*280:enable='between(t,8.0,13.0)'[motion];
    [motion]
      drawtext=fontfile=${font_bold}:text='1  AIM  •  TIPS APART':x=(w-text_w)/2:y=1628:fontsize=57:fontcolor=0xFFFFFF:enable='between(t,0,4.0)',
      drawtext=fontfile=${font_regular}:text='MOVE YOUR INDEX TIP TO AIM':x=(w-text_w)/2:y=1722:fontsize=34:fontcolor=0x6DE9E4:enable='between(t,0,4.0)',
      drawtext=fontfile=${font_bold}:text='2  PINCH  •  TOUCH BOTH TIPS':x=(w-text_w)/2:y=1628:fontsize=49:fontcolor=0xFFFFFF:enable='between(t,4.0,8.0)',
      drawtext=fontfile=${font_regular}:text='HOLD YOUR AIM WHILE TIPS TOUCH':x=(w-text_w)/2:y=1722:fontsize=31:fontcolor=0xF5C96A:enable='between(t,4.0,8.0)',
      drawtext=fontfile=${font_bold}:text='3  RELEASE  •  OPEN A LITTLE':x=(w-text_w)/2:y=1628:fontsize=49:fontcolor=0xFFFFFF:enable='between(t,8.0,13.0)',
      drawtext=fontfile=${font_regular}:text='ONE RELEASE FIRES  •  NO SECOND PINCH':x=(w-text_w)/2:y=1722:fontsize=29:fontcolor=0x6DE9E4:enable='between(t,8.0,13.0)',
      drawtext=fontfile=${font_bold}:text='4  MATCH 3+ SAME ORBS':x=(w-text_w)/2:y=1628:fontsize=57:fontcolor=0xF4E9CE:enable='between(t,13.0,18)',
      drawtext=fontfile=${font_regular}:text='UNCERTAIN FRAMES NEVER SHOOT':x=(w-text_w)/2:y=1722:fontsize=34:fontcolor=0x79EFB9:enable='between(t,13.0,18)',
      fade=t=in:st=0:d=0.25,fade=t=out:st=17.5:d=0.5,format=yuv420p[outv];
    [3:a]atrim=0:18,volume=0.12,afade=t=in:st=0:d=0.5,afade=t=out:st=17:d=1,alimiter=limit=0.9[aout]
  " \
  -map '[outv]' -map '[aout]' -t 18 -r 30 \
  -c:v libx264 -preset medium -crf 18 -profile:v high -level 4.1 \
  -c:a aac -b:a 128k -ar 48000 -movflags +faststart "$video"

ffmpeg -hide_banner -loglevel warning -y -ss 10.4 -i "$video" -frames:v 1 -update 1 -q:v 2 "$poster"
ffmpeg -hide_banner -loglevel warning -y -i "$video" -vf "fps=1/2,scale=270:480,tile=5x2" -frames:v 1 -update 1 -q:v 3 "$sheet"
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of json "$video"
sha256sum "$video"
