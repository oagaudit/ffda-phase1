"""โครงสร้างฐานข้อมูล — ออกแบบให้รองรับหลายปี (2569, 2570, ...) ตั้งแต่ต้น

หลักการ:
- organization  = ทะเบียน อปท. (ไม่ผูกกับปี) ใช้รหัส อปท. 8 หลักของ สถ. เป็นคีย์
- assessment    = ผลประเมิน 1 แถว ต่อ 1 อปท. ต่อ 1 ปี  (unique: year + org_code)
- answer        = คะแนน/คำตอบรายข้อ (long format) ทำให้ปีหน้าเพิ่ม/ลด/เปลี่ยนข้อได้โดยไม่ต้องแก้ตาราง
- question      = คลังคำถามแยกตามปี (ข้อคำถามปี 70 อาจต่างจากปี 69) + item_key ผูกข้อเดียวกันข้ามปี
- questionnaire = โครงสร้างแบบประเมินรายปี (ต้องอนุมัติก่อนนำเข้า)
- import_batch  = ประวัติการนำเข้า (ใคร นำเข้าไฟล์อะไร เมื่อไร ผลเป็นอย่างไร)
"""
from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer,
                        String, Text, UniqueConstraint, Index)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Province(Base):
    __tablename__ = "province"
    code: Mapped[str] = mapped_column(String(2), primary_key=True)
    name_th: Mapped[str] = mapped_column(String(100), unique=True)
    name_en: Mapped[str] = mapped_column(String(100))
    region: Mapped[str] = mapped_column(String(50))  # ภูมิภาค (แก้ไขได้ เช่น เปลี่ยนเป็นเขต สตง.ภูมิภาค)


class Organization(Base):
    __tablename__ = "organization"
    code: Mapped[str] = mapped_column(String(8), primary_key=True)        # รหัส อปท. (สถ.)
    oag_code: Mapped[str | None] = mapped_column(String(20))               # รหัส อปท (สตง.)
    name: Mapped[str] = mapped_column(String(255))
    org_type: Mapped[str] = mapped_column(String(50))                      # อบต. / เทศบาลตำบล / เทศบาลเมือง / เทศบาลนคร / อบจ.
    district: Mapped[str | None] = mapped_column(String(100))
    subdistrict: Mapped[str | None] = mapped_column(String(100))           # ตำบล (จากทะเบียน อปท.)
    province_code: Mapped[str | None] = mapped_column(ForeignKey("province.code"))
    amp_code: Mapped[str | None] = mapped_column(String(4), index=True)    # รหัสอำเภอ (ตรงกับแผนที่)
    tam_code: Mapped[str | None] = mapped_column(String(6), index=True)    # รหัสตำบล (ตรงกับแผนที่)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    province: Mapped[Province | None] = relationship()


class AssessmentYear(Base):
    __tablename__ = "assessment_year"
    year: Mapped[int] = mapped_column(Integer, primary_key=True)          # ปี พ.ศ. เช่น 2569
    label: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="draft")      # draft = เห็นเฉพาะ จนท. / published = เผยแพร่
    n_records: Mapped[int] = mapped_column(Integer, default=0)
    imported_at: Mapped[datetime | None] = mapped_column(DateTime)
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    note: Mapped[str | None] = mapped_column(Text)


class Question(Base):
    __tablename__ = "question"
    __table_args__ = (UniqueConstraint("year", "q_no", name="uq_question_year_no"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("assessment_year.year", ondelete="CASCADE"))
    q_no: Mapped[int] = mapped_column(Integer)
    part: Mapped[int] = mapped_column(Integer)                             # ด้าน 1-4
    text: Mapped[str] = mapped_column(Text)
    short: Mapped[str] = mapped_column(String(200))
    max_g1: Mapped[float] = mapped_column(Float)                           # คะแนนเต็ม (อบต./เทศบาล)
    max_g2: Mapped[float] = mapped_column(Float)                           # คะแนนเต็ม (อบจ.)
    # รหัสตัวชี้วัดถาวร (ไม่ผูกกับเลขข้อ) — ใช้เทียบข้อเดียวกันข้ามปี แม้เลขข้อจะเลื่อน เช่น REV-01, ACC-07
    item_key: Mapped[str | None] = mapped_column(String(20), index=True)
    # การเปลี่ยนแปลงเทียบปีฐาน: same / reworded (ปรับถ้อยคำ เทียบได้) / changed (เปลี่ยนสาระ เทียบไม่ได้) / new
    change: Mapped[str | None] = mapped_column(String(20))
    text_g2: Mapped[str | None] = mapped_column(Text)                      # ข้อความคำถามฉบับ อบจ. (ถ้าต่างจากฉบับ อบต./เทศบาล)


class Questionnaire(Base):
    """โครงสร้างแบบประเมินของแต่ละปี (ข้อคำถาม คะแนนเต็ม รหัสตัวชี้วัด คอลัมน์ Excel)
    ต้องได้รับ "อนุมัติ" ก่อนจึงนำเข้าผลประเมินปีนั้นได้ — ป้องกันการนำเข้าไฟล์ที่ข้อคำถามเปลี่ยนโดยไม่รู้ตัว"""
    __tablename__ = "questionnaire"
    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")       # draft / approved
    base_year: Mapped[int | None] = mapped_column(Integer)                 # ปีที่ใช้เทียบ
    definition: Mapped[dict] = mapped_column(JSON)                          # รูปแบบเดียวกับไฟล์ mappings/<ปี>.json
    diff: Mapped[dict | None] = mapped_column(JSON)                         # สรุปการเปลี่ยนแปลงเทียบปีฐาน
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(150))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
    approved_by: Mapped[str | None] = mapped_column(String(150))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)


class Assessment(Base):
    __tablename__ = "assessment"
    __table_args__ = (
        UniqueConstraint("year", "org_code", name="uq_assessment_year_org"),
        Index("ix_assessment_year", "year"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("assessment_year.year", ondelete="CASCADE"))
    org_code: Mapped[str] = mapped_column(ForeignKey("organization.code"))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    form_group: Mapped[int] = mapped_column(Integer)                       # 1 = อบต./เทศบาล, 2 = อบจ.

    p1: Mapped[float] = mapped_column(Float)   # ด้านรายได้
    p2: Mapped[float] = mapped_column(Float)   # ด้านรายจ่าย
    p3: Mapped[float] = mapped_column(Float)   # ด้านจัดซื้อจัดจ้างและพัสดุ
    p4: Mapped[float] = mapped_column(Float)   # ด้านบัญชี รายงาน และตรวจสอบ
    p1_max: Mapped[float] = mapped_column(Float)
    p2_max: Mapped[float] = mapped_column(Float)
    p3_max: Mapped[float] = mapped_column(Float)
    p4_max: Mapped[float] = mapped_column(Float)

    q_pct: Mapped[float] = mapped_column(Float)      # คะแนนแบบประเมิน (%)
    q40: Mapped[float] = mapped_column(Float)        # ส่วนแบบประเมิน (40%)
    lpa10: Mapped[float] = mapped_column(Float)      # LPA (10%)
    fin50: Mapped[float] = mapped_column(Float)      # รายงานการเงิน (50%)
    total: Mapped[float] = mapped_column(Float)      # รวม 100%
    grade: Mapped[str | None] = mapped_column(String(50))

    # หมายเหตุ: ผลวิเคราะห์ ML/AI (เฟส 2) จะเก็บใน "ตารางแยก" ผูกกับรุ่นโมเดล ไม่เพิ่มคอลัมน์ในตารางนี้
    #          เพื่อให้ตารางผลประเมินเป็น "ข้อมูลทางการ" ที่ไม่เปลี่ยนตามโมเดล

    organization: Mapped[Organization] = relationship()
    answers: Mapped[list["Answer"]] = relationship(back_populates="assessment", cascade="all, delete-orphan")


class Answer(Base):
    __tablename__ = "answer"
    __table_args__ = (Index("ix_answer_assessment", "assessment_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessment.id", ondelete="CASCADE"))
    q_no: Mapped[int] = mapped_column(Integer)
    score: Mapped[float | None] = mapped_column(Float)      # None = ไม่เข้าเงื่อนไข (ไม่มีคะแนน/ไม่มีตัวหาร)
    max_score: Mapped[float] = mapped_column(Float)
    answer_text: Mapped[str | None] = mapped_column(Text)
    item_key: Mapped[str | None] = mapped_column(String(20))               # สำเนารหัสตัวชี้วัด (ค้นข้ามปีได้เร็ว)

    assessment: Mapped[Assessment] = relationship(back_populates="answers")


class ImportBatch(Base):
    __tablename__ = "import_batch"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year: Mapped[int] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20))          # success / failed
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0)
    warnings: Mapped[list | None] = mapped_column(JSON)
    created_by: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class User(Base):
    __tablename__ = "app_user"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # ไม่มีรหัสผ่าน — ยืนยันตัวตนด้วย SSO/AD ผ่าน IIS; ตารางนี้ใช้กำหนดสิทธิ์และบันทึกผู้ที่เคยเข้าใช้
    username: Mapped[str] = mapped_column(String(150), unique=True)       # บัญชี AD เช่น OAG\\somchai.k
    full_name: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="officer")   # admin = นำเข้า/เผยแพร่/ตั้งค่า, officer = ดูข้อมูลทั้งหมด
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class SavedView(Base):
    __tablename__ = "saved_view"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    owner: Mapped[str] = mapped_column(String(100))
    config: Mapped[dict] = mapped_column(JSON)
    shared: Mapped[bool] = mapped_column(Boolean, default=False)       # แชร์ให้ จนท. คนอื่นเห็น
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class AppSetting(Base):
    __tablename__ = "app_setting"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict | list] = mapped_column(JSON)
