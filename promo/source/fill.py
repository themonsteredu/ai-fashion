# compose.html 의 CLIPS / SCENES / SUBS 채우기 + frames 폴더 준비
import os, shutil, json, glob, re
def prep(name, srcs):
    d = f'frames/{name}'
    if name != 'mission':
        shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
        n = 0
        for s in srcs:
            for f in sorted(glob.glob(f'clips/{s}/*.jpg')):
                n += 1; shutil.copy(f, f'{d}/{n:05d}.jpg')
    return len(glob.glob(f'{d}/*.jpg'))
clips = {}
for name, srcs in [('start', ['start']), ('mission', []), ('result', ['mission4']), ('free', ['free']), ('photo', ['photo']), ('video', ['video']), ('upload', ['upload']), ('admin', ['admin'])]:
    if srcs and not glob.glob(f'clips/{srcs[0]}/*.jpg'): continue
    clips[name] = {'n': prep(name, srcs), 'w': 1600}
F = lambda v0, v1: [v0, v1]
SCENES = [
  {'id': 's-hero', 'dur': 4.8},
  {'id': 's-start', 'dur': 4.6, 'img': 'v-start', 'segs': [{'clip': 'start', 'from': 0.0, 'rate': 1, 'len': 4.6, 'view': F([0,0,1600],[30,40,1340])}]},
  {'id': 's-demo', 'dur': 5.4, 'img': 'v-demo', 'segs': [{'clip': 'mission', 'from': 3.85, 'rate': 1, 'len': 5.4, 'view': F([0,0,1600],[0,50,1120])}]},
  {'id': 's-play', 'dur': 6.2, 'img': 'v-play', 'segs': [
      {'clip': 'mission', 'from': 0.9, 'rate': 1, 'len': 3.2, 'view': F([0,0,1600],[30,20,1540])},
      {'clip': 'mission', 'from': 12.7, 'rate': 1, 'len': 3.0, 'view': F([30,20,1540],[0,0,1600])}]},
  {'id': 's-result', 'dur': 4.2, 'img': 'v-result', 'segs': [{'clip': 'result', 'from': 0.0, 'rate': 1, 'len': 4.2, 'view': F([240,90,1120],[340,160,900])}]},
  {'id': 's-cards', 'dur': 5.4},
  {'id': 's-free', 'dur': 7.0, 'img': 'v-free', 'segs': [
      {'clip': 'free', 'from': 0.9, 'rate': 1, 'len': 7.0, 'view': F([0,0,1600],[60,30,1360])}]},
  {'id': 's-photo', 'dur': 6.0, 'img': 'v-photo', 'segs': [
      {'clip': 'photo', 'from': 0.4, 'rate': 1, 'len': 4.5, 'view': F([0,0,1600],[120,50,1340])},
      {'clip': 'video', 'from': 0.5, 'rate': 1, 'len': 1.5, 'view': F([150,50,1300],[220,90,1160])}]},
  {'id': 's-upload', 'dur': 4.8, 'img': 'v-upload', 'segs': [{'clip': 'upload', 'from': 0.2, 'rate': 1, 'len': 4.8, 'view': F([0,0,1600],[50,30,1500])}]},
  {'id': 's-admin', 'dur': 5.0, 'img': 'v-admin', 'segs': [{'clip': 'admin', 'from': 0.2, 'rate': 1, 'len': 5.0, 'view': F([0,0,1600],[380,30,880])}]},
  {'id': 's-outro', 'dur': 5.8},
]
# 녹화가 아직 없는 클립은 start로 임시 대체 (테스트용)
for s in SCENES:
    for g in s.get('segs', []):
        if g['clip'] not in clips: g['clip'] = 'start'
SUBS = [
  [0.4, 3.9, '카메라 앞에서 움직이면, 3D 아바타가 그대로 따라 해요.'],
  [4.4, 8.0, '시작 화면에서 포즈 미션이나 자유 체험을 골라 바로 시작해요.'],
  [8.4, 12.7, '미션 카드가 뜨면, 아바타가 먼저 시범 포즈를 보여 줘요.'],
  [13.2, 18.3, '웹캠이 내 자세를 읽고, 포즈가 맞으면 게이지가 차오르며 성공!'],
  [18.8, 21.9, '미션을 마치면 몇 개를 성공했는지 바로 알려 줘요.'],
  [22.4, 26.7, '만세, 비행기, 티라노 공룡까지! 45가지 포즈가 랜덤으로 나와요.'],
  [27.2, 32.9, '자유 체험에서는 아바타가 내 움직임을 실시간으로 따라 해요.'],
  [33.6, 38.5, '3초 카운트다운 사진과 영상으로 기념도 남길 수 있어요.'],
  [39.0, 42.7, 'VRoid로 만든 내 아바타 파일을 불러와 체험할 수도 있어요.'],
  [43.2, 47.1, '미션 개수와 합격 기준은 운영자 설정에서 바꿀 수 있어요.'],
  [47.6, 52.6, '인터넷 없이도 작동하는 패션 아바타 스튜디오, 지금 만나 보세요!'],
]
h = open('compose.html').read()
h = re.sub(r'/\*CLIPS\*/\{.*?\};', '/*CLIPS*/' + json.dumps(clips, ensure_ascii=False) + ';', h, flags=re.S)
h = re.sub(r'/\*SCENES\*/\[.*?\];\n', '/*SCENES*/' + json.dumps(SCENES, ensure_ascii=False) + ';\n', h, flags=re.S)
h = re.sub(r'/\*SUBS\*/\[.*?\];\n', '/*SUBS*/' + json.dumps(SUBS, ensure_ascii=False) + ';\n', h, flags=re.S)
open('compose.html', 'w').write(h)
json.dump(SUBS, open('subs.json', 'w'), ensure_ascii=False)
print(clips)
