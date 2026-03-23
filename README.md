# 공간연출과 졸업작품 심사 시스템

학생들의 졸업작품 기획안 업로드 및 교수진 심사, 성적 통계를 관리하는 웹 시스템입니다.

## 기술 스택

- **Frontend**: React 19, TypeScript, Tailwind CSS, Framer Motion
- **Backend**: Express.js, Node.js
- **Database**: PostgreSQL
- **Storage**: Supabase Storage (이미지 업로드)
- **Auth**: JWT (httpOnly Cookie)

## 환경변수 설정

`.env.example`을 참고하여 `.env` 파일을 생성하세요.

| 변수명 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `JWT_SECRET` | JWT 서명 키 (필수) |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스 롤 키 |
| `SUPABASE_STORAGE_BUCKET` | 이미지 버킷명 (기본값: work-images) |

## 실행 방법

```bash
npm install
npm run dev
