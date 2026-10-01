import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ImagePlus, Trash2, UserRound, X } from "lucide-react";
import clsx from "clsx";
import { profileLabel, setProfileAvatar, type Profile } from "../lib/profiles";
import { AvatarError, loadAvatarSource, renderAvatar } from "../lib/avatarImage";
import { MAX_ZOOM, MIN_ZOOM, cropRect, initialCrop, panBy, zoomTo, type CropState } from "../lib/avatarCrop";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { ProfileAvatar } from "./ProfileAvatar";
import { Slider } from "./Slider";

/** Сторона окна кадра, px. Круг вписан в него. */
const VIEW = 240;

/**
 * Фото аккаунта: загрузить новое, выбрать, что попадёт в круг, удалить.
 *
 * Кадр двигается мышью или пальцем, масштаб — бегунком и колесом. Сохраняется
 * только выбранный кадр, уменьшенный до 128 px (`lib/avatarImage`), — поэтому
 * перекадрировать уже сохранённое фото нельзя: исходника нет, надо загрузить
 * его заново.
 */
export function AvatarModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [source, setSource] = useState<{ bitmap: ImageBitmap; url: string } | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const label = profileLabel(profile);

  // Картинка в окне — тем же файлом через object URL; освобождаем при смене.
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url);
    },
    [source]
  );

  async function open(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const bitmap = await loadAvatarSource(file);
      setSource({ bitmap, url: URL.createObjectURL(file) });
      setCrop(initialCrop(bitmap.width, bitmap.height, VIEW));
    } catch (e) {
      setError(e instanceof AvatarError ? e.message : "Не удалось открыть фото");
    }
  }

  function save() {
    if (!source || !crop) return;
    let url: string;
    try {
      url = renderAvatar(source.bitmap, cropRect(crop));
    } catch (e) {
      setError(e instanceof AvatarError ? e.message : "Не удалось обработать фото");
      return;
    }
    if (!setProfileAvatar(profile.id, url)) {
      setError("Фото не сохранилось: в браузере кончилось место");
      return;
    }
    onClose();
  }

  function remove() {
    setProfileAvatar(profile.id, null);
    onClose();
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !crop) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setCrop(panBy(crop, dx, dy));
  };
  const endDrag = () => {
    drag.current = null;
  };

  // Колесо — масштаб вокруг курсора. Слушатель не пассивный: иначе страница
  // под окном прокручивалась бы вместе с масштабом.
  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !crop) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setCrop((c) => (c ? zoomTo(c, c.zoom * Math.exp(-e.deltaY / 400), { x: e.clientX - r.left, y: e.clientY - r.top }) : c));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [crop]);

  // Живой предпросмотр в размере шапки — тот же кадр, что уйдёт в аватар.
  const preview = crop && source ? cropRect(crop) : null;

  return (
    <Modal onClose={onClose} width="md">
      <ModalHeader icon={UserRound} title="Фото аккаунта" subtitle={label} />
      <ModalBody gap={3}>
        <div
          className={clsx(
            "rounded-xl border border-dashed p-3 flex flex-col items-center gap-3 transition-colors",
            dragOver ? "border-accent bg-accent/5" : "border-border"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void open(e.dataTransfer.files?.[0]);
          }}
        >
          {crop && source ? (
            <>
              <div
                ref={viewRef}
                className="relative overflow-hidden rounded-lg bg-panel2 touch-none select-none cursor-grab active:cursor-grabbing"
                style={{ width: VIEW, height: VIEW }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                aria-label="Кадр: перетащите фото, чтобы выбрать, что попадёт в круг"
                role="img"
              >
                <img
                  src={source.url}
                  alt=""
                  draggable={false}
                  className="absolute max-w-none pointer-events-none"
                  style={{
                    left: crop.x,
                    top: crop.y,
                    width: crop.w * (VIEW / Math.min(crop.w, crop.h)) * crop.zoom,
                    height: crop.h * (VIEW / Math.min(crop.w, crop.h)) * crop.zoom,
                  }}
                />
                {/* Всё вне круга притушено — видно, что останется в аватаре. */}
                <div className="absolute inset-0 rounded-full pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-white/80" />
              </div>
              <div className="w-full flex items-center gap-3">
                <Slider
                  layout="stacked"
                  className="flex-1"
                  label="Масштаб"
                  value={crop.zoom}
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(z) => setCrop((c) => (c ? zoomTo(c, z) : c))}
                />
                {preview && <CropPreview url={source.url} crop={crop} size={44} />}
              </div>
              <p className="text-xs text-muted text-center">
                Перетащите фото, чтобы выбрать, что попадёт в круг.
              </p>
            </>
          ) : (
            <>
              <ProfileAvatar profile={profile} size={112} />
              <p className="text-xs text-muted text-center max-w-xs">
                {profile.avatar
                  ? "Загрузите новое фото или перетащите его сюда — потом выберете, что попадёт в круг."
                  : "Загрузите фото или перетащите его сюда. Без фото аккаунт показан буквами на цвете."}
              </p>
            </>
          )}
          <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost text-sm">
            <ImagePlus className="w-4 h-4" />
            {crop ? "Выбрать другое фото" : "Загрузить фото"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Файл фото"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void open(file);
            }}
          />
        </div>
        {error && <p className="text-xs text-expense">{error}</p>}
      </ModalBody>
      <ModalFooter justify="between" className="flex-wrap gap-y-2">
        {profile.avatar ? (
          <button type="button" onClick={remove} className="btn-danger text-sm">
            <Trash2 className="w-3.5 h-3.5" />
            Удалить фото
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            <X className="w-3.5 h-3.5" />
            Отмена
          </button>
          <button type="button" onClick={save} disabled={!crop} className="btn-primary text-sm">
            <Check className="w-3.5 h-3.5" />
            Сохранить
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}

/** Круг с тем же кадром в размере аватара шапки. */
function CropPreview({ url, crop, size }: { url: string; crop: CropState; size: number }) {
  const r = cropRect(crop);
  const k = size / r.side;
  return (
    <span
      className="relative shrink-0 rounded-full overflow-hidden bg-panel2 ring-1 ring-border"
      style={{ width: size, height: size }}
      title="Так фото будет выглядеть в шапке"
    >
      <img
        src={url}
        alt=""
        draggable={false}
        className="absolute max-w-none"
        style={{ left: -r.sx * k, top: -r.sy * k, width: crop.w * k, height: crop.h * k }}
      />
    </span>
  );
}
