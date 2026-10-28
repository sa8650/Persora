// Description: File picker pattern (@reui/c-attachment-6) powered by useFileUpload, Attachment, and FileType
"use client"

import type { InputHTMLAttributes, ReactNode } from "react"
import { UploadIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  formatBytes,
  useFileUpload,
  type FileMetadata,
} from "@/hooks/use-file-upload"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Spinner } from "@/components/ui/spinner"
import { FileType, getFileType } from "@/components/reui/file-type"

const INITIAL_FILES: FileMetadata[] = [
  {
    id: "specs-1",
    name: "design-tokens.json",
    size: 48200,
    type: "application/json",
    url: "#",
  },
]

export function Pattern() {
  const [{ files, isDragging, errors }, actions] = useFileUpload({
    multiple: true,
    maxFiles: 5,
    maxSize: 10 * 1024 * 1024,
    initialFiles: INITIAL_FILES,
  })

  return (
    <div className="w-full max-w-sm">
      <AttachmentGroup>
        <Attachment
          state="idle"
          onDragEnter={actions.handleDragEnter}
          onDragLeave={actions.handleDragLeave}
          onDragOver={actions.handleDragOver}
          onDrop={actions.handleDrop}
          className={isDragging ? "border-ring bg-accent/50" : undefined}
        >
          <input {...actions.getInputProps()} className="sr-only" tabIndex={-1} />
          <AttachmentTrigger
            aria-label="Upload files"
            onClick={actions.openFileDialog}
          />
          <AttachmentMedia>
            <UploadIcon />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>Drop files or click to browse</AttachmentTitle>
            <AttachmentDescription>Up to 5 files, 10 MB each</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
        {errors[0] && <p className="text-xs text-destructive">{errors[0]}</p>}
        {files.map((item) => (
          <Attachment key={item.id} size="sm">
            <AttachmentMedia variant={item.preview && item.file.type.startsWith("image/") ? "image" : "default"}>
              {item.preview && item.file.type.startsWith("image/") ? (
                <img src={item.preview} alt="" />
              ) : (
                <FileType
                  type={getFileType(item.file.name || item.file.type)}
                  size="sm"
                  variant="light"
                  aria-hidden
                />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{item.file.name}</AttachmentTitle>
              <AttachmentDescription>
                {formatBytes(item.file.size)}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                aria-label={`Remove ${item.file.name}`}
                onClick={() => actions.removeFile(item.id)}
              >
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))}
      </AttachmentGroup>
    </div>
  )
}

export interface AttachmentPickerItem {
  id: string
  name: string
  size?: number
  type?: string
  previewUrl?: string | null
  description?: ReactNode
  state?: "idle" | "uploading" | "processing" | "error" | "done"
  onOpen?: () => void
  onRemove?: () => void
  removeLabel?: string
  actions?: ReactNode
}

export interface ReuiFileAttachmentFieldProps {
  /** Optional explicit id placed on the hidden file <input>. */
  inputId?: string
  inputProps?: InputHTMLAttributes<HTMLInputElement>
  inputAriaLabel?: string
  accept?: string
  multiple?: boolean
  maxFiles?: number
  maxSize?: number
  disabled?: boolean
  uploading?: boolean
  title?: ReactNode
  description?: ReactNode
  triggerAriaLabel?: string
  items?: AttachmentPickerItem[]
  /** Single-file convenience props for single-attachment forms. */
  file?: File | null
  existingFile?: { name: string; type?: string; size?: number; url?: string | null } | null
  onFileSelect?: (file: File | null) => void
  onRemoveExisting?: () => void
  onError?: (message: string) => void
  /** Hide the dashed picker row when a single-file slot is already filled and should be replaced via item actions. */
  hidePickerWhenFilled?: boolean
  onFilesSelected?: (files: File[]) => void
  onValidationError?: (message: string) => void
  className?: string
  pickerClassName?: string
}

/**
 * System-wide Persora file picker & attachment tray built directly on `@reui/c-attachment-6`
 * (`useFileUpload` + `Attachment` + `FileType` + `Spinner`).
 */
export function ReuiFileAttachmentField({
  inputId,
  inputProps,
  inputAriaLabel,
  accept = "*",
  multiple = false,
  maxFiles,
  maxSize,
  disabled = false,
  uploading = false,
  title = "Drop a file here or click to browse",
  description = "Stored privately in Persora",
  triggerAriaLabel = "Upload file",
  items,
  file,
  existingFile,
  onFileSelect,
  onRemoveExisting,
  onError,
  hidePickerWhenFilled = false,
  onFilesSelected,
  onValidationError,
  className,
  pickerClassName,
}: ReuiFileAttachmentFieldProps) {
  const resolvedItems: AttachmentPickerItem[] = items ?? (
    file
      ? [{
          id: `selected-${file.name}-${file.size}`,
          name: file.name,
          size: file.size,
          type: file.type,
          state: uploading ? "uploading" : "done",
          onRemove: onFileSelect ? () => onFileSelect(null) : undefined,
        }]
      : existingFile
        ? [{
            id: `existing-${existingFile.name}`,
            name: existingFile.name,
            size: existingFile.size,
            type: existingFile.type,
            previewUrl: existingFile.url,
            description: typeof existingFile.size === "number" ? formatBytes(existingFile.size) : "Saved attachment",
            state: "done",
            onRemove: onRemoveExisting,
          }]
        : []
  )

  const [{ isDragging, errors }, actions] = useFileUpload({
    accept,
    multiple,
    maxFiles,
    maxSize,
    onFilesAdded: (added) => {
      const rawFiles = added
        .map((entry) => entry.file)
        .filter((candidate): candidate is File => candidate instanceof File)
      if (rawFiles.length) {
        onFilesSelected?.(rawFiles)
        onFileSelect?.(rawFiles[0])
      }
      actions.clearFiles()
    },
    onError: ( errs ) => {
      if (errs[0]) {
        onValidationError?.(errs[0])
        onError?.(errs[0])
      }
    },
  })

  const showPicker = !(hidePickerWhenFilled && resolvedItems.length > 0)
  const mergedInputProps = actions.getInputProps({
    ...inputProps,
    id: inputId ?? inputProps?.id,
    "aria-label": inputAriaLabel ?? inputProps?.["aria-label"],
    disabled: disabled || uploading || inputProps?.disabled,
  })

  return (
    <AttachmentGroup className={cn("w-full", className)}>
      {showPicker && (
        <Attachment
          state={uploading ? "uploading" : "idle"}
          onDragEnter={disabled || uploading ? undefined : actions.handleDragEnter}
          onDragLeave={disabled || uploading ? undefined : actions.handleDragLeave}
          onDragOver={disabled || uploading ? undefined : actions.handleDragOver}
          onDrop={disabled || uploading ? undefined : actions.handleDrop}
          className={cn(
            isDragging && !disabled && "border-ring bg-accent/50",
            disabled && "opacity-60",
            pickerClassName
          )}
        >
          <input {...mergedInputProps} className="sr-only" tabIndex={-1} />
          <AttachmentTrigger
            type="button"
            aria-label={triggerAriaLabel}
            disabled={disabled || uploading}
            onClick={actions.openFileDialog}
          />
          <AttachmentMedia>
            {uploading ? <Spinner /> : <UploadIcon />}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{title}</AttachmentTitle>
            {description ? (
              <AttachmentDescription>{description}</AttachmentDescription>
            ) : null}
          </AttachmentContent>
        </Attachment>
      )}
      {!showPicker && (
        <input {...mergedInputProps} className="sr-only" tabIndex={-1} />
      )}
      {errors[0] && (
        <p className="text-xs text-destructive" role="alert">
          {errors[0]}
        </p>
      )}
      {resolvedItems.map((item) => {
        const isImg = Boolean(
          item.previewUrl &&
            ((item.type && item.type.startsWith("image/")) ||
              /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(item.name))
        )
        const rowState = item.state ?? "done"
        return (
          <Attachment key={item.id} size="sm" state={rowState}>
            {item.onOpen && (
              <AttachmentTrigger
                type="button"
                aria-label={`Open ${item.name}`}
                onClick={item.onOpen}
              />
            )}
            <AttachmentMedia variant={isImg ? "image" : "default"}>
              {rowState === "uploading" || rowState === "processing" ? (
                <Spinner className="size-3.5" />
              ) : isImg && item.previewUrl ? (
                <img src={item.previewUrl} alt="" />
              ) : (
                <FileType
                  type={getFileType(item.name || item.type || "")}
                  size="sm"
                  variant="light"
                  aria-hidden
                />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{item.name}</AttachmentTitle>
              <AttachmentDescription>
                {item.description ??
                  (typeof item.size === "number" ? formatBytes(item.size) : "")}
              </AttachmentDescription>
            </AttachmentContent>
            {(item.actions || item.onRemove) && (
              <AttachmentActions>
                {item.actions}
                {item.onRemove && (
                  <AttachmentAction
                    type="button"
                    aria-label={item.removeLabel || `Remove ${item.name}`}
                    disabled={disabled || uploading}
                    onClick={item.onRemove}
                  >
                    <XIcon />
                  </AttachmentAction>
                )}
              </AttachmentActions>
            )}
          </Attachment>
        )
      })}
    </AttachmentGroup>
  )
}
