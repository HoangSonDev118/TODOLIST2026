"use client";

import * as Ably from "ably";
import { useCallback, useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { SLOTS, STATUS_LABEL } from "../lib/constants";
import { absDayToDate, absDayToDateInput, dateInputToAbsDay, dayShortOf } from "../lib/date";
import { colorToDisplayHex } from "../lib/domain/task";
import { getMultiDayEndSlot, isMultiDayTask } from "../lib/multi-day";
import type { ScheduleScope, SessionUser, Task, TaskComment, TaskLabelValue } from "../lib/types";
import { HalfHourTimePicker } from "./HalfHourTimePicker";

interface TaskImage {
  id: number;
  imageUrl: string;
  createdAt: string;
}

interface TaskEditModalProps {
  task: Task;
  isCompanySchedule: boolean;
  scheduleScope: ScheduleScope;
  scheduleOwnerId: number | null;
  isOverdue: boolean;
  isReadOnly: boolean;
  isDark: boolean;
  isViewingOwnSchedule: boolean;
  users: SessionUser[];
  currentUser: SessionUser | null;
  onClose: () => void;
  onDelete: () => void;
  onAccept: () => void;
  onCommentCountChange: (count: number) => void;
  onPatch: (patch: Partial<Task>) => void;
}

function displayDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${dayShortOf(date)}, ${day}/${month}/${date.getFullYear()}`;
}

function statusBadgeClass(status: Task["status"]): string {
  if (status === "DONE") return "border border-emerald-400/25 bg-emerald-500/15 text-emerald-400";
  if (status === "IN_PROGRESS") return "border border-sky-400/25 bg-sky-500/15 text-sky-400";
  return "border border-amber-400/25 bg-amber-500/15 text-amber-400";
}

function DatePickerField({ date, value, min, onChange }: { date: Date; value: string; min?: string; onChange: (value: string) => void }) {
  return (
    <label className="relative min-w-0 cursor-pointer whitespace-nowrap">
      <span>{displayDate(date)}</span>
      <input type="date" value={value} min={min} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Chọn ngày" />
    </label>
  );
}

function LargeAvatar({ name, avatar }: { name: string | null; avatar: string | null }) {
  if (avatar) return <img src={avatar} alt={name ?? "avatar"} className="h-12 w-12 shrink-0 rounded-full object-cover" />;
  return <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-600 text-lg font-bold text-white">{name?.trim().charAt(0).toUpperCase() || "?"}</span>;
}

function SmallAvatar({ name, avatar }: { name: string | null; avatar: string | null }) {
  if (avatar) return <img src={avatar} alt={name ?? "avatar"} className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-600 text-xs font-bold text-white">{name?.trim().charAt(0).toUpperCase() || "?"}</span>;
}

function commentTimeLabel(createdAt: string) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (elapsedSeconds < 60) return "Vừa xong";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

export function TaskEditModal({ task, isCompanySchedule, scheduleScope, scheduleOwnerId, isOverdue, isReadOnly, isDark, isViewingOwnSchedule, users, currentUser, onClose, onDelete, onAccept, onCommentCountChange, onPatch }: TaskEditModalProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [confirmersOpen, setConfirmersOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const pickerRef = useRef<HTMLDivElement>(null);
  const confirmersRef = useRef<HTMLDivElement>(null);
  const isMultiDay = isMultiDayTask(task);
  const startDate = absDayToDate(task.absDay);
  const endAbsDay = task.endAbsDay ?? task.absDay;
  const endDate = absDayToDate(endAbsDay);
  const taskColor = colorToDisplayHex(task.color, isDark);
  const ownerName = task.createdByName ?? task.assignedFromName ?? currentUser?.name ?? "Người tạo task";
  const ownerAvatar = task.createdByAvatar ?? currentUser?.avatar ?? null;
  const titleAvatarName = isCompanySchedule ? (task.updatedByName ?? ownerName) : ownerName;
  const titleAvatar = isCompanySchedule ? (task.updatedByAvatar ?? ownerAvatar) : ownerAvatar;
  const [commenters, setCommenters] = useState<TaskComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentSending, setCommentSending] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);
  const [newCommentId, setNewCommentId] = useState<number | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [images, setImages] = useState<TaskImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const onCommentCountChangeRef = useRef(onCommentCountChange);
  onCommentCountChangeRef.current = onCommentCountChange;
  const confirmedUsers = task.confirmedByUserIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is SessionUser => Boolean(user));
  const visibleConfirmedUsers = confirmedUsers.length > 5 ? confirmedUsers.slice(0, 4) : confirmedUsers.slice(0, 5);
  const hiddenConfirmedCount = confirmedUsers.length - visibleConfirmedUsers.length;
  const canAcceptTask = !isCompanySchedule
    && task.status === "PENDING"
    && Boolean(task.assignedFromName)
    && currentUser !== null
    && scheduleOwnerId === currentUser.id;
  const patchAndMarkChanged = (patch: Partial<Task>) => {
    if (isReadOnly) return;
    setHasChanges(true);
    onPatch(patch);
  };
  const submitComment = async () => {
    const text = commentDraft.trim();
    if (!text || !currentUser || commentSending) return;
    setCommentSending(true);
    setCommentError(null);
    try {
      const response = await fetch("/api/schedule/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: scheduleScope, ownerId: scheduleOwnerId, taskId: task.id, authorUserId: currentUser.id, content: text }),
      });
      if (!response.ok) throw new Error("Không thể gửi bình luận.");
      const savedComment = await response.json() as TaskComment;
      setCommenters((current) => {
        const next = current.some((comment) => comment.id === savedComment.id) ? current : [savedComment, ...current];
        onCommentCountChange(next.length);
        return next;
      });
      setNewCommentId(savedComment.id);
      setCommentDraft("");
      setCommentsOpen(true);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Không thể gửi bình luận.");
    } finally {
      setCommentSending(false);
    }
  };
  const deleteComment = async (commentId: number) => {
    if (!currentUser || deletingCommentId !== null) return;
    if (!window.confirm("Bạn có chắc muốn xóa bình luận này không?")) return;
    setDeletingCommentId(commentId);
    setCommentError(null);
    try {
      const response = await fetch("/api/schedule/comments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: scheduleScope, ownerId: scheduleOwnerId, taskId: task.id, commentId, authorUserId: currentUser.id }),
      });
      if (!response.ok) throw new Error("Không thể xóa bình luận.");
      setCommenters((current) => {
        const next = current.filter((comment) => comment.id !== commentId);
        onCommentCountChange(next.length);
        return next;
      });
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Không thể xóa bình luận.");
    } finally {
      setDeletingCommentId(null);
    }
  };

  const loadImages = async () => {
    const params = new URLSearchParams({ scope: scheduleScope, taskId: String(task.id) });
    if (scheduleScope === "USER" && scheduleOwnerId !== null) params.set("ownerId", String(scheduleOwnerId));
    try {
      const response = await fetch(`/api/schedule/tasks/images?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Không thể tải hình ảnh.");
      const data = await response.json() as TaskImage[];
      setImages(data);
      setImageError(null);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Không thể tải hình ảnh.");
    } finally {
      setImagesLoading(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 10 * 1024 * 1024) {
      setImageError("Kích thước ảnh quá lớn. Tối đa 10MB.");
      return;
    }
    setImageUploading(true);
    setImageError(null);
    try {
      // Step 1: Upload to Cloudinary via server API
      const uploadFormData = new FormData();
      uploadFormData.append("file", file);
      
      const uploadResponse = await fetch("/api/schedule/tasks/images/upload", {
        method: "POST",
        body: uploadFormData,
      });
      
      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json().catch(() => ({ error: "Không thể tải ảnh lên Cloudinary." }));
        throw new Error(errorData.error || "Không thể tải ảnh lên Cloudinary.");
      }
      
      const { imageUrl } = await uploadResponse.json() as { imageUrl: string };
      
      if (!imageUrl) {
        throw new Error("Không nhận được URL ảnh từ Cloudinary.");
      }
      
      // Step 2: Save URL to database
      const response = await fetch("/api/schedule/tasks/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: scheduleScope, ownerId: scheduleOwnerId, taskId: task.id, imageUrl }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Không thể lưu ảnh." }));
        throw new Error(errorData.error || "Không thể lưu ảnh.");
      }
      const savedImage = await response.json() as TaskImage;
      setImages((current) => [...current, savedImage]);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Không thể tải lên ảnh.");
    } finally {
      setImageUploading(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleImageUpload(file);
    if (event.target) event.target.value = "";
  };

  const deleteImage = async (imageId: number) => {
    const params = new URLSearchParams({ scope: scheduleScope, imageId: String(imageId) });
    if (scheduleScope === "USER" && scheduleOwnerId !== null) params.set("ownerId", String(scheduleOwnerId));
    try {
      const response = await fetch(`/api/schedule/tasks/images?${params}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Không thể xóa ảnh.");
      setImages((current) => current.filter((img) => img.id !== imageId));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Không thể xóa ảnh.");
    }
  };

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const goToPrevImage = useCallback(() => {
    setLightboxIndex((prev) => prev !== null && prev > 0 ? prev - 1 : prev);
  }, []);

  const goToNextImage = useCallback(() => {
    setLightboxIndex((prev) => prev !== null && prev < images.length - 1 ? prev + 1 : prev);
  }, [images.length]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") goToPrevImage();
      else if (e.key === "ArrowRight") goToNextImage();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [lightboxIndex, closeLightbox, goToPrevImage, goToNextImage]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ scope: scheduleScope, taskId: String(task.id) });
    if (scheduleScope === "USER" && scheduleOwnerId !== null) params.set("ownerId", String(scheduleOwnerId));
    const loadComments = async () => {
      const response = await fetch(`/api/schedule/comments?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Không thể tải bình luận.");
      const next = await response.json() as TaskComment[];
      if (!active) return;
      setCommenters(next);
      setCommentError(null);
    };
    void loadComments().catch((error: unknown) => {
      if (active) setCommentError(error instanceof Error ? error.message : "Không thể tải bình luận.");
    }).finally(() => {
      if (active) setCommentsLoading(false);
    });

    const client = new Ably.Realtime({ authUrl: "/api/realtime/token" });
    const channel = client.channels.get(scheduleScope === "COMPANY" ? "schedule:company" : `schedule:user:${scheduleOwnerId}`);
    const onCommentChanged = (message: Ably.Message) => {
      const event = message.data as { taskId?: number; comment?: TaskComment; deletedId?: number } | null;
      if (event?.taskId !== task.id) return;
      setCommenters((current) => {
        let next = current;
        if (event.deletedId !== undefined) next = current.filter((comment) => comment.id !== event.deletedId);
        if (event.comment) next = current.some((comment) => comment.id === event.comment!.id)
          ? current.map((comment) => comment.id === event.comment!.id ? event.comment! : comment)
          : [event.comment, ...current];
        if (next !== current) onCommentCountChangeRef.current(next.length);
        return next;
      });
    };
    channel.subscribe("comments.changed", onCommentChanged);

    return () => {
      active = false;
      void channel.unsubscribe("comments.changed", onCommentChanged);
      client.close();
    };
  }, [scheduleOwnerId, scheduleScope, task.id]);

  useEffect(() => {
    if (!pickerOpen) return;
    const closePicker = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, [pickerOpen]);

  useEffect(() => {
    if (!confirmersOpen) return;
    const closeConfirmers = (event: PointerEvent) => {
      if (!confirmersRef.current?.contains(event.target as Node)) setConfirmersOpen(false);
    };
    document.addEventListener("pointerdown", closeConfirmers);
    return () => document.removeEventListener("pointerdown", closeConfirmers);
  }, [confirmersOpen]);

  useEffect(() => {
    setImagesLoading(true);
    setImages([]);
    void loadImages();
  }, [scheduleOwnerId, scheduleScope, task.id]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <section className="relative max-h-[94vh] w-full max-w-[455px] overflow-y-auto rounded-xl bg-[#242424] text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div ref={pickerRef} className="relative">
          {isReadOnly ? (
            <div className="h-[68px] w-full rounded-t-xl" style={{ backgroundColor: taskColor }} />
          ) : (
            <button
              type="button"
              className="block h-[68px] w-full rounded-t-xl transition-[filter] hover:brightness-110"
              style={{ backgroundColor: taskColor }}
              onClick={() => setPickerOpen((open) => !open)}
              aria-label="Đổi màu công việc"
            />
          )}
          {pickerOpen && (
            <div className="absolute left-5 top-14 z-20 rounded-xl bg-zinc-900 p-3 shadow-2xl ring-1 ring-white/15">
              <HexColorPicker color={taskColor} onChange={(color) => patchAndMarkChanged({ color })} />
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-300">
                <span>Màu công việc</span><span className="font-mono uppercase">{taskColor}</span>
              </div>
            </div>
          )}
          <button type="button" onClick={onClose} aria-label={hasChanges ? "Hoàn tất chỉnh sửa" : "Đóng"} className="group absolute right-0 top-0 flex h-[68px] w-20 items-start justify-end pr-4 pt-3">
            <span className={`flex h-11 w-11 items-center justify-center rounded-full transition ${hasChanges ? "border border-emerald-300/60 bg-emerald-500/30 text-emerald-50 shadow-[0_0_0_3px_rgba(16,185,129,0.12)] group-hover:bg-emerald-500/40" : "bg-black/30 text-4xl font-light leading-none group-hover:bg-black/45"}`}>
              {hasChanges ? <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden><path d="m5 12.5 4.25 4.25L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg> : "×"}
            </span>
          </button>
        </div>

        <div className="flex h-16 items-center justify-between border-b border-white/15 px-[18px]">
          {isOverdue ? <span className={`rounded-md border px-4 py-2 text-sm font-bold ${isCompanySchedule ? "border-zinc-400/25 bg-zinc-400/15 text-zinc-300" : "border-red-400/25 bg-red-500/15 text-red-400"}`}>{isCompanySchedule ? "Đã hết hạn" : "Quá hạn"}</span> : isCompanySchedule ? (
            <div ref={confirmersRef} className="relative min-w-0">
              <button type="button" onClick={() => setConfirmersOpen((open) => !open)} aria-expanded={confirmersOpen} className="flex min-w-0 items-center gap-2 text-sm font-bold">
                <svg viewBox="0 0 20 20" fill="none" className={`h-5 w-5 shrink-0 transition-transform ${confirmersOpen ? "rotate-180" : ""}`} aria-hidden><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>Đã xác nhận</span>
                <div className="flex -space-x-2">
                  {visibleConfirmedUsers.map((user) => (
                    <img key={user.id} src={user.avatar} alt={user.name} title={user.name} className="h-6 w-6 rounded-full border-2 border-[#242424] object-cover" />
                  ))}
                  {hiddenConfirmedCount > 0 && (
                    <span className="relative flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[#242424] bg-zinc-600 px-1 text-[10px] font-bold text-white" title={`${hiddenConfirmedCount} người khác`}>
                      +{hiddenConfirmedCount}
                    </span>
                  )}
                </div>
              </button>
              {confirmersOpen && (
                <div className="absolute left-0 top-9 z-10 min-w-56 rounded-lg border border-white/15 bg-zinc-800 p-2 shadow-xl">
                  {confirmedUsers.length > 0 ? confirmedUsers.map((user) => (
                    <div key={user.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-white/5">
                      <SmallAvatar name={user.name} avatar={user.avatar} /><span className="break-words">{user.name}</span>
                    </div>
                  )) : <p className="px-2 py-1.5 text-sm text-zinc-400">Chưa có người xác nhận</p>}
                </div>
              )}
            </div>
          ) : (
            canAcceptTask ? (
              <button type="button" onClick={() => { setHasChanges(true); onAccept(); }} className="rounded-md bg-amber-400 px-5 py-2 text-sm font-bold text-black transition hover:bg-amber-300">Nhận</button>
            ) : (
              <span className={`rounded-md px-5 py-2 text-sm font-semibold ${statusBadgeClass(task.status)}`}>
                {task.status === "PENDING" ? "Đang chờ" : STATUS_LABEL[task.status]}
              </span>
            )
          )}
          {!isCompanySchedule && isViewingOwnSchedule && !isReadOnly && (
            <select
              value={task.label}
              onChange={(e) => patchAndMarkChanged({ label: e.target.value as TaskLabelValue })}
              className={`rounded-md px-2 py-2 text-xs font-semibold border transition cursor-pointer outline-none ${task.label === "PERSONAL" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-zinc-700 text-zinc-300 border-zinc-600"}`}
              title="Chọn loại công việc"
            >
              <option value="PERSONAL">🔒 Việc cá nhân</option>
              <option value="DEFAULT">Giao việc</option>
            </select>
          )}
          <button type="button" onClick={onDelete} className="rounded-md bg-red-500 px-5 py-2 text-sm font-bold transition hover:bg-red-600">Xóa</button>
        </div>

        <div className="border-b border-white/15 px-[18px] py-5">
          <div className="flex items-center gap-4">
            <LargeAvatar name={titleAvatarName} avatar={titleAvatar} />
            <textarea readOnly={isReadOnly} rows={1} value={title} onChange={(event) => { setTitle(event.target.value); setHasChanges(true); }} onBlur={() => { if (!isReadOnly) onPatch({ title }); }} className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-base font-bold leading-snug outline-none [field-sizing:content]" placeholder="Tên công việc" />
            {!isReadOnly && <button type="button" onClick={() => { setTitle(""); patchAndMarkChanged({ title: "" }); }} aria-label="Xóa tiêu đề" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-600 text-sm text-zinc-300">×</button>}
          </div>
          <textarea readOnly={isReadOnly} value={description} onChange={(event) => { setDescription(event.target.value); setHasChanges(true); }} onBlur={() => { if (!isReadOnly) onPatch({ description }); }} className="mt-3 h-[60px] w-full resize-none overflow-y-auto bg-transparent text-sm leading-5 outline-none" placeholder="Nhập mô tả" />
          
          {/* Image Section */}
          <div className="mt-3">
            {!isReadOnly && (
              <div className="flex items-center gap-2 mb-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Chọn ảnh từ thư viện"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Chụp ảnh bằng camera sau"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imageUploading || images.length >= 5}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-2 text-sm text-zinc-400 transition hover:border-white/40 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Chọn ảnh từ thư viện"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
                    <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Ảnh
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={imageUploading || images.length >= 5}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-2 text-sm text-zinc-400 transition hover:border-white/40 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Mở camera sau để chụp ảnh"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
                    <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.8"/>
                  </svg>
                  Chụp
                </button>
                {imageUploading && (
                  <span className="flex items-center gap-1.5 text-xs text-sky-400">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" aria-hidden />
                    Đang tải lên...
                  </span>
                )}
              </div>
            )}
            
            {imageError && <p className="mb-2 text-xs text-red-400">{imageError}</p>}
            
            {/* Image Preview Grid */}
            {images.length > 0 && (
              <div className={`grid gap-2 ${images.length === 1 ? "grid-cols-1" : images.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                {images.map((image, index) => (
                  <div key={image.id} className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-800">
                    <button
                      type="button"
                      onClick={() => openLightbox(index)}
                      className="absolute inset-0 z-10 cursor-zoom-in"
                      aria-label={`Xem ảnh phóng to ${index + 1}`}
                    />
                    <img
                      src={image.imageUrl}
                      alt={`Ảnh đính kèm ${image.id}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {/* Always visible delete button */}
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void deleteImage(image.id); }}
                        className="absolute right-1 top-1 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-red-500/90 text-white shadow-lg transition hover:bg-red-600 active:scale-95"
                        aria-label="Xóa ảnh"
                      >
                        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                          <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    )}
                    {/* Zoom icon indicator */}
                    <div className="absolute left-1.5 bottom-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white/80">
                      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
                        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {imagesLoading && (
              <div className="flex items-center justify-center py-4">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" aria-hidden />
              </div>
            )}
          </div>
        </div>

        <div className={`border-b border-white/15 px-[18px] py-4 ${isReadOnly ? "pointer-events-none opacity-75" : ""}`}>
          <div className="flex items-center gap-4 text-xl font-bold">
            <input
              id={`multi-day-task-${task.id}`}
              type="checkbox"
              checked={isMultiDay}
              onChange={(event) => patchAndMarkChanged(event.target.checked
                ? { endAbsDay: task.absDay + 1, endSlotIndex: Math.min(SLOTS - 1, task.slotIndex + task.span) }
                : { endAbsDay: undefined, endSlotIndex: undefined })}
              className="h-5 w-5 cursor-pointer accent-purple-600"
            />
            <label htmlFor={`multi-day-task-${task.id}`} className="cursor-pointer">Task nhiều ngày</label>
          </div>

          {!isMultiDay ? (
            <div className="mt-6 flex items-center justify-between gap-3 text-lg font-bold">
              <DatePickerField date={startDate} value={absDayToDateInput(task.absDay)} onChange={(value) => { const day = dateInputToAbsDay(value); if (day !== null) patchAndMarkChanged({ absDay: day }); }} />
              <div className="flex items-center gap-3 whitespace-nowrap tabular-nums">
                <HalfHourTimePicker value={task.slotIndex} maxSlot={Math.min(47, task.slotIndex + task.span - 1)} onChange={(slot) => patchAndMarkChanged({ slotIndex: slot, span: task.slotIndex + task.span - slot })} ariaLabel="Chọn giờ bắt đầu" />
                <span className="flex w-4 items-center justify-center leading-none">−</span>
                <HalfHourTimePicker value={task.slotIndex + task.span} minSlot={task.slotIndex + 1} maxSlot={48} includeNextMidnight onChange={(endSlot) => patchAndMarkChanged({ span: endSlot - task.slotIndex })} ariaLabel="Chọn giờ kết thúc" />
                <span className="text-sm text-zinc-500">{task.span * 30} phút</span>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4 text-lg font-bold">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <DatePickerField date={startDate} value={absDayToDateInput(task.absDay)} onChange={(value) => { const day = dateInputToAbsDay(value); if (day !== null) patchAndMarkChanged({ absDay: day, endAbsDay: Math.max(day + 1, endAbsDay) }); }} />
                <span className="text-sm text-zinc-500">Bắt đầu</span>
                <HalfHourTimePicker value={task.slotIndex} onChange={(slot) => patchAndMarkChanged({ slotIndex: slot })} ariaLabel="Chọn giờ bắt đầu" />
              </div>
              <div className="pl-16 text-4xl font-light leading-none">↓</div>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <DatePickerField date={endDate} min={absDayToDateInput(task.absDay)} value={absDayToDateInput(endAbsDay)} onChange={(value) => { const day = dateInputToAbsDay(value); if (day !== null) patchAndMarkChanged({ endAbsDay: Math.max(task.absDay + 1, day) }); }} />
                <span className="text-sm text-zinc-500">Kết thúc</span>
                <HalfHourTimePicker value={getMultiDayEndSlot(task)} onChange={(slot) => patchAndMarkChanged({ endSlotIndex: slot })} ariaLabel="Chọn giờ kết thúc" />
              </div>
              <p className="sr-only">{dayShortOf(startDate)} đến {dayShortOf(endDate)}</p>
            </div>
          )}
        </div>

        <div className="px-[18px] py-5">
          {!isReadOnly && <div className="flex items-center gap-3 border-b border-white/15 pb-3">
            <SmallAvatar name={currentUser?.name ?? "Tôi"} avatar={currentUser?.avatar ?? null} />
            <input maxLength={2000} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitComment(); }} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-zinc-500" placeholder="Nhập bình luận..." />
            <button type="button" onClick={() => void submitComment()} disabled={!commentDraft.trim() || !currentUser || commentSending} aria-label="Gửi bình luận" className="flex h-8 w-8 items-center justify-center text-sky-400 transition disabled:cursor-not-allowed disabled:opacity-35">
              {commentSending ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" aria-hidden /> : <span className="text-3xl">➤</span>}
            </button>
          </div>}
          {commentError && <p className="mt-2 text-xs text-red-400">{commentError}</p>}
          <button type="button" onClick={() => setCommentsOpen((open) => !open)} disabled={commentsLoading} aria-expanded={commentsOpen} className="mt-4 flex h-6 items-center gap-2 text-base font-bold disabled:cursor-default">
            {commentsLoading ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent" aria-hidden /><span>Đang tải</span></> : <span>{commenters.length} comment</span>}
            {!commentsLoading && <svg viewBox="0 0 20 20" fill="none" className={`h-5 w-5 transition-transform ${commentsOpen ? "rotate-180" : ""}`} aria-hidden><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
          <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${commentsOpen ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"}`}>
            <div className={`min-h-0 overflow-hidden ${commentsOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
              <div className="h-[220px] overflow-y-auto pr-2">
            {!commentsLoading && commenters.length === 0 ? (
              <div className="flex h-full items-center justify-center" aria-label="Chưa có bình luận">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/5 bg-white/[0.035] text-zinc-600 shadow-inner">
                  <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {commenters.map((comment) => (
                  <div key={comment.id} className={`flex gap-3 ${comment.id === newCommentId ? "schedule-comment-enter" : ""}`}>
                    <SmallAvatar name={comment.authorName} avatar={comment.authorAvatar} />
                    <div className="min-w-0 text-sm leading-snug">
                      <p>
                        <span className="font-bold">{comment.authorUserId === currentUser?.id ? "Tôi" : comment.authorName}</span>
                        <span className="ml-1 text-zinc-500">{commentTimeLabel(comment.createdAt)}</span>
                        {comment.authorUserId === currentUser?.id && <button type="button" onClick={() => void deleteComment(comment.id)} disabled={deletingCommentId === comment.id} className="ml-2 font-medium text-red-400 transition hover:text-red-300 disabled:opacity-50">{deletingCommentId === comment.id ? "Đang xóa" : "Xóa"}</button>}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-zinc-100">{comment.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
              </div>
            </div>
          </div>
        </div>

        {/* Lightbox for full-screen image view */}
        {lightboxIndex !== null && images[lightboxIndex] && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95" onClick={closeLightbox}>
            {/* Close button */}
            <button
              type="button"
              onClick={closeLightbox}
              className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Đóng xem ảnh"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
                <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* Previous button */}
            {lightboxIndex > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); goToPrevImage(); }}
                className="absolute left-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label="Ảnh trước"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" aria-hidden>
                  <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}

            {/* Image */}
            <img
              src={images[lightboxIndex].imageUrl}
              alt={`Ảnh phóng to ${lightboxIndex + 1} / ${images.length}`}
              className="max-h-[90vh] max-w-[90vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />

            {/* Next button */}
            {lightboxIndex < images.length - 1 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); goToNextImage(); }}
                className="absolute right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label="Ảnh tiếp theo"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" aria-hidden>
                  <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}

            {/* Image counter */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-4 py-1.5 text-sm text-white">
              {lightboxIndex + 1} / {images.length}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
