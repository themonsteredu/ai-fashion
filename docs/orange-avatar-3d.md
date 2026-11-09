# 주황 조끼 3D 샘플

기존 `character.png`를 참고해 생성한 입체 모델을 Blender에서 정리하고 VRM 1.0으로 연결했다. 기존 그림은 `?avatar=picture`에서 비교할 수 있다. 사용자 그림/VRM 업로드와 20명 릴레이는 그대로 지원한다.

## 원본과 재현

- 웹 실행 파일: `assets/orange-boy.vrm`
- 텍스처가 포함된 편집 원본: `assets/source/orange-boy.blend`
- 변환 스크립트: `scripts/prepare-orange-avatar.py`
- Blender 4.3.2, VRM Add-on for Blender 4.10.4
- 입력 그림: 저장소의 `character.png`
- 생성: `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, 요청 `01a1be71-b6bc-70a3-b795-f21763e2ba46`
- 골격 초안: `fal-ai/meshy/rigging`, 요청 `01a1be75-6651-7b72-97d1-682fa28857e0`
- [생성 GLB](https://v3b.fal.media/files/b/0ab1ba13/gyleoyzbQvljRrtpESoNv_model.glb)
- [골격 GLB](https://v3b.fal.media/files/b/0ab1ba21/kL2yowl1Hb2XsBvrrCXd-_rigged_character.glb)
- [골격 FBX](https://v3b.fal.media/files/b/0ab1ba20/8OlD75UK2kcU8QSims91V_rigged_character.fbx)

외부 생성 URL은 만료될 수 있다. 편집 가능한 모델과 텍스처는 위 Blender 파일에 함께 보존한다. 실행 시 외부 생성 API를 호출하지 않는다.

## 정리한 부분

A 자세를 T 기준 자세로 굽혀 메시와 관절의 기준을 함께 저장했다. 다리 기준을 정렬하고 발바닥 높이를 맞췄다. 자동 리깅이 조끼 옆부분을 팔에 붙이는 문제를 원본 UV 색과 몸통 위치로 보정하고, UV 이음매에서도 관절 영향이 이어지도록 가중치를 다듬었다. 소매와 위팔의 영향 범위를 별도로 조정했다. 웹 스키닝에 맞춰 꼭짓점당 최대 4개 관절의 가중치를 정규화했다.

웹캠에서 어깨 회전이 위팔 회전에 중복으로 더해지던 계산을 수정했다. 3D 시범 자세에도 어깨 상승을 적용하되, 위팔 방향은 목표 자세를 유지하도록 보정한다.

텍스처는 몸체 2048px, 보조 텍스처 1024px로 줄였다. 브라우저는 일반 스킨드 메시를 사용하며 Blender의 Preserve Volume 옵션에 의존하지 않는다.

## 범위

이 샘플은 전신 관절 체험용이다. 생성된 모습이 참고 그림과 완전히 같지는 않으며, 손가락 개별 관절·표정·입 모양은 포함하지 않는다. 몸통/옷/머리가 한 재질로 생성되어 부위별 색상 꾸미기는 제공하지 않는다. 개별 꾸미기가 필요한 사용자 VRM은 기존 방식으로 불러올 수 있다.

자동 검증은 카메라 입력을 대체한 좌표와 실제 웹 렌더링을 사용한다. 실제 학생·웹캠의 가림과 구도에 따른 추적 품질은 현장 확인이 필요하다.
