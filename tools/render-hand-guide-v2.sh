#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$project_dir/outputs/handtracking-tutorial"
font_bold="/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"
font_regular="/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"

ffmpeg -y \
  -loop 1 -t 34.2 -i "$project_dir/output/playwright/hand-guide-map.png" \
  -loop 1 -t 34.2 -i "$project_dir/output/playwright/hand-guide-setup.png" \
  -loop 1 -t 34.2 -i "$project_dir/output/playwright/paopao-v10-gameplay-desktop.png" \
  -loop 1 -t 34.2 -i "$output_dir/hand-gestures-transparent.png" \
  -loop 1 -t 34.2 -i "$project_dir/public/assets/sprites/v11/phoenix-green.png" \
  -i "$output_dir/hand-guide-voice.wav" \
  -i "$project_dir/public/assets/audio/prism-pulse-game.ogg" \
  -filter_complex "
    [0:v]crop=408:720:436:0,scale=1080:1920,trim=duration=6.2,setpts=PTS-STARTPTS[mode];
    [1:v]crop=408:720:436:0,scale=1080:1920,trim=duration=12.0,setpts=PTS-STARTPTS[setup];
    [2:v]crop=720:1280:260:0,scale=1080:1920,trim=duration=16.0,setpts=PTS-STARTPTS[game];
    [mode][setup][game]concat=n=3:v=1:a=0[base];
    [3:v]crop=610:887:0:0,scale=430:-1,format=rgba[open];
    [3:v]crop=520:887:630:0,scale=430:-1,format=rgba,split=2[pinch_cal][pinch_aim];
    [3:v]crop=574:887:1200:0,scale=430:-1,format=rgba[release];
    [4:v]scale=112:112,format=rgba[orb];
    [base]
      drawbox=x=0:y=0:w=1080:h=250:color=0x020817@0.93:t=fill,
      drawbox=x=38:y=32:w=1004:h=172:color=0x0A2036@0.97:t=fill,
      drawbox=x=38:y=32:w=11:h=172:color=0x56E8DC@1:t=fill,
      drawtext=fontfile=${font_bold}:text='HAND TRACKING - EASY GUIDE':x=(w-text_w)/2:y=62:fontsize=55:fontcolor=0xF4E9CE,
      drawtext=fontfile=${font_regular}:text='PAOPAO FUSION':x=(w-text_w)/2:y=142:fontsize=29:fontcolor=0x6DE9E4,
      drawbox=x=0:y=1630:w=1080:h=290:color=0x020817@0.92:t=fill[chrome];
    [chrome]
      drawbox=x=98:y=1730:w=454:h=116:color=0x56E8DC@0.18:t=fill:enable='between(t,3.2,6.2)',
      drawbox=x=98:y=1730:w=454:h=116:color=0x56E8DC@1:t=12:enable='between(t,3.2,6.2)',
      drawbox=x=82:y=765:w=465:h=105:color=0x56E8DC@1:t=12:enable='between(t,6.2,9.4)',
      drawbox=x=98:y=1190:w=455:h=116:color=0x56E8DC@1:t=12:enable='between(t,9.4,12.7)',
      drawbox=x=547:y=1190:w=435:h=116:color=0x56E8DC@1:t=12:enable='between(t,12.7,15.6)',
      drawbox=x=242:y=1332:w=595:h=112:color=0xF5C96A@1:t=12:enable='between(t,15.6,18.2)',
      drawbox=x=922:y=1765:w=148:h=132:color=0x56E8DC@1:t=12:enable='between(t,18.2,21.4)'[marked];
    [marked][open]overlay=x=325:y=1030+15*sin(t*3):enable='between(t,9.4,12.7)'[h1];
    [h1][pinch_cal]overlay=x=325:y=1030+15*sin(t*3):enable='between(t,12.7,15.6)'[h2];
    [h2][pinch_aim]overlay=x=325+80*sin(t*1.6):y=1060+35*cos(t*1.3):enable='between(t,21.4,27)'[h3];
    [h3][release]overlay=x=325:y=1060+15*sin(t*3):enable='between(t,27,31)'[h4];
    [h4][orb]overlay=x=486:y=1540-(t-27)*265:enable='between(t,27,30.8)'[motion];
    [motion]
      drawtext=fontfile=${font_bold}:text='+':x=510+170*sin(t*1.6):y=640+80*cos(t*1.3):fontsize=110:fontcolor=0x6DE9E4:enable='between(t,21.4,27)',
      drawtext=fontfile=${font_bold}:text='SETUP SIRF 1 DAFA':x=(w-text_w)/2:y=1680:fontsize=64:fontcolor=0xFFFFFF:enable='between(t,0,3.2)',
      drawtext=fontfile=${font_regular}:text='PEHLE CALIBRATE - PHIR DIRECT PLAY':x=(w-text_w)/2:y=1780:fontsize=34:fontcolor=0x6DE9E4:enable='between(t,0,3.2)',
      drawtext=fontfile=${font_bold}:text='1  HAND SETUP DABAO':x=(w-text_w)/2:y=1658:fontsize=58:fontcolor=0xFFFFFF:enable='between(t,3.2,6.2)',
      drawtext=fontfile=${font_regular}:text='LEVEL SELECT SCREEN KE NEECHE':x=(w-text_w)/2:y=1755:fontsize=34:fontcolor=0x6DE9E4:enable='between(t,3.2,6.2)',
      drawtext=fontfile=${font_bold}:text='2  START CAMERA':x=(w-text_w)/2:y=1658:fontsize=62:fontcolor=0xFFFFFF:enable='between(t,6.2,9.4)',
      drawtext=fontfile=${font_regular}:text='BROWSER MEIN ALLOW DABAO':x=(w-text_w)/2:y=1755:fontsize=37:fontcolor=0x6DE9E4:enable='between(t,6.2,9.4)',
      drawtext=fontfile=${font_bold}:text='3  HAATH KHOL KAR':x=(w-text_w)/2:y=1658:fontsize=58:fontcolor=0xFFFFFF:enable='between(t,9.4,12.7)',
      drawtext=fontfile=${font_regular}:text='CAPTURE OPEN DABAO':x=(w-text_w)/2:y=1755:fontsize=39:fontcolor=0x6DE9E4:enable='between(t,9.4,12.7)',
      drawtext=fontfile=${font_bold}:text='4  THUMB + INDEX MILAO':x=(w-text_w)/2:y=1658:fontsize=51:fontcolor=0xFFFFFF:enable='between(t,12.7,15.6)',
      drawtext=fontfile=${font_regular}:text='CAPTURE PINCH DABAO':x=(w-text_w)/2:y=1755:fontsize=39:fontcolor=0x6DE9E4:enable='between(t,12.7,15.6)',
      drawtext=fontfile=${font_bold}:text='5  SAVE CALIBRATION':x=(w-text_w)/2:y=1658:fontsize=57:fontcolor=0xFFFFFF:enable='between(t,15.6,18.2)',
      drawtext=fontfile=${font_regular}:text='AB SETUP COMPLETE HAI':x=(w-text_w)/2:y=1755:fontsize=38:fontcolor=0xF5C96A:enable='between(t,15.6,18.2)',
      drawtext=fontfile=${font_bold}:text='6  GAME MEIN HAND DABAO':x=(w-text_w)/2:y=1658:fontsize=50:fontcolor=0xFFFFFF:enable='between(t,18.2,21.4)',
      drawtext=fontfile=${font_regular}:text='BUTTON NEECHE RIGHT SIDE PAR HAI':x=(w-text_w)/2:y=1755:fontsize=34:fontcolor=0x6DE9E4:enable='between(t,18.2,21.4)',
      drawtext=fontfile=${font_bold}:text='7  PINCH RAKHO + HAATH MOVE KARO':x=(w-text_w)/2:y=1658:fontsize=43:fontcolor=0xFFFFFF:enable='between(t,21.4,27)',
      drawtext=fontfile=${font_regular}:text='CURSOR JIDHAR - AIM UDHAR':x=(w-text_w)/2:y=1755:fontsize=37:fontcolor=0x6DE9E4:enable='between(t,21.4,27)',
      drawtext=fontfile=${font_bold}:text='8  FINGERS RELEASE = SHOOT':x=(w-text_w)/2:y=1658:fontsize=49:fontcolor=0xFFFFFF:enable='between(t,27,31)',
      drawtext=fontfile=${font_regular}:text='NISHANA SET HO TO PINCH KHOL DO':x=(w-text_w)/2:y=1755:fontsize=34:fontcolor=0x6DE9E4:enable='between(t,27,31)',
      drawtext=fontfile=${font_bold}:text='MATCH 3+ SAME COLOUR':x=(w-text_w)/2:y=1658:fontsize=58:fontcolor=0xF4E9CE:enable='between(t,31,34.2)',
      drawtext=fontfile=${font_regular}:text='BAS - AB PLAY KARO!':x=(w-text_w)/2:y=1755:fontsize=40:fontcolor=0x6DE9E4:enable='between(t,31,34.2)',
      fade=t=in:st=0:d=0.3,fade=t=out:st=33.7:d=0.5,format=yuv420p[outv];
    [5:a]atrim=0:34.2,adelay=350|350,loudnorm=I=-16:TP=-1.5:LRA=9[voice];
    [6:a]atrim=0:34.2,volume=0.09,afade=t=in:st=0:d=0.6,afade=t=out:st=33:d=1.2[music];
    [voice][music]amix=inputs=2:duration=longest:dropout_transition=0,alimiter=limit=0.95[aout]
  " \
  -map '[outv]' -map '[aout]' -t 34.2 -r 30 \
  -c:v libx264 -preset medium -crf 18 -profile:v high -level 4.1 \
  -c:a aac -b:a 160k -ar 48000 -movflags +faststart \
  "$output_dir/paopao-handtracking-complete-guide-v2.mp4"
