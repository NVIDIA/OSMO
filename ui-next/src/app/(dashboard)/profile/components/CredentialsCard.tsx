/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/shadcn/card";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/shadcn/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Collapsible, CollapsibleContent } from "@/components/shadcn/collapsible";
import { Key, Database, Lock, Package, Plus, Pencil, Trash2, Eye, EyeOff } from "lucide-react";
import { useServices } from "@/contexts";
import { useMounted } from "@/hooks";
import { useUpsertCredential, useDeleteCredential } from "@/lib/api/adapter";
import type { Credential, CredentialCreate } from "@/lib/api/adapter";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

type CredentialType = "registry" | "data" | "generic";

interface CredentialFormData {
  name: string;
  type: CredentialType;
  registry: { url: string; username: string; password: string };
  data: { endpoint: string; access_key: string; secret_key: string };
  generic: { key: string; value: string };
}

// Edits are tracked per credential ID - maps ID to edited form data
interface CredentialEdits {
  [credentialId: string]: CredentialFormData;
}

// =============================================================================
// Utility Functions
// =============================================================================

function createEmptyFormData(): CredentialFormData {
  return {
    name: "",
    type: "registry",
    registry: { url: "", username: "", password: "" },
    data: { endpoint: "", access_key: "", secret_key: "" },
    generic: { key: "", value: "" },
  };
}

function createFormDataFromCredential(credential: Credential): CredentialFormData {
  return {
    name: credential.name,
    type: credential.type,
    registry: credential.registry ?? { url: "", username: "", password: "" },
    data: credential.data ?? { endpoint: "", access_key: "", secret_key: "" },
    generic: credential.generic ?? { key: "", value: "" },
  };
}

function formDataToCredentialCreate(formData: CredentialFormData): CredentialCreate {
  const base = { name: formData.name, type: formData.type };

  if (formData.type === "registry") {
    return { ...base, registry: formData.registry };
  } else if (formData.type === "data") {
    return { ...base, data: formData.data };
  } else {
    return { ...base, generic: formData.generic };
  }
}

function isFormValid(formData: CredentialFormData): boolean {
  if (!formData.name.trim()) return false;

  if (formData.type === "registry") {
    return !!(formData.registry.url.trim() && formData.registry.username.trim() && formData.registry.password.trim());
  } else if (formData.type === "data") {
    return !!(formData.data.endpoint.trim() && formData.data.access_key.trim() && formData.data.secret_key.trim());
  } else {
    return !!(formData.generic.key.trim() && formData.generic.value.trim());
  }
}

// Group credentials by type for organized display
function groupCredentialsByType(credentials: Credential[]) {
  const registry: Credential[] = [];
  const data: Credential[] = [];
  const generic: Credential[] = [];

  for (const cred of credentials) {
    if (cred.type === "registry") {
      registry.push(cred);
    } else if (cred.type === "data") {
      data.push(cred);
    } else {
      generic.push(cred);
    }
  }

  return { registry, data, generic };
}

// Format relative time for credential display
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Updated today";
  if (diffDays === 1) return "Updated 1 day ago";
  if (diffDays < 7) return `Updated ${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `Updated ${weeks} week${weeks > 1 ? "s" : ""} ago`;
  }
  const months = Math.floor(diffDays / 30);
  return `Updated ${months} month${months > 1 ? "s" : ""} ago`;
}

// =============================================================================
// Sub-Components
// =============================================================================

// Credential section header with icon
function CredentialSectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-[0.9375rem] font-semibold">
      <Icon className="size-4" />
      {title}
    </h3>
  );
}

// Form fields for registry credentials
function RegistryFields({
  values,
  onChange,
  disabled,
  showPassword,
  onTogglePasswordVisibility,
}: {
  values: { url: string; username: string; password: string };
  onChange: (key: "url" | "username" | "password", value: string) => void;
  disabled: boolean;
  showPassword: boolean;
  onTogglePasswordVisibility: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="cred-registry-url"
          className="mb-1.5 block text-sm font-medium"
        >
          Registry URL
        </label>
        <Input
          id="cred-registry-url"
          type="text"
          placeholder="e.g., docker.io, ghcr.io"
          value={values.url}
          onChange={(e) => onChange("url", e.target.value)}
          disabled={disabled}
        />
      </div>
      <div>
        <label
          htmlFor="cred-registry-username"
          className="mb-1.5 block text-sm font-medium"
        >
          Username
        </label>
        <Input
          id="cred-registry-username"
          type="text"
          placeholder="Registry username"
          value={values.username}
          onChange={(e) => onChange("username", e.target.value)}
          disabled={disabled}
        />
      </div>
      <div>
        <label
          htmlFor="cred-registry-password"
          className="mb-1.5 block text-sm font-medium"
        >
          Password / Token
        </label>
        <div className="relative">
          <Input
            id="cred-registry-password"
            type={showPassword ? "text" : "password"}
            placeholder="Registry password or access token"
            value={values.password}
            onChange={(e) => onChange("password", e.target.value)}
            disabled={disabled}
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={onTogglePasswordVisibility}
            disabled={disabled}
            title={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Form fields for data credentials
function DataFields({
  values,
  onChange,
  disabled,
  showSecret,
  onToggleSecretVisibility,
}: {
  values: { endpoint: string; access_key: string; secret_key: string };
  onChange: (key: "endpoint" | "access_key" | "secret_key", value: string) => void;
  disabled: boolean;
  showSecret: boolean;
  onToggleSecretVisibility: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="cred-data-endpoint"
          className="mb-1.5 block text-sm font-medium"
        >
          Endpoint
        </label>
        <Input
          id="cred-data-endpoint"
          type="text"
          placeholder="e.g., s3.amazonaws.com"
          value={values.endpoint}
          onChange={(e) => onChange("endpoint", e.target.value)}
          disabled={disabled}
        />
      </div>
      <div>
        <label
          htmlFor="cred-data-access-key"
          className="mb-1.5 block text-sm font-medium"
        >
          Access Key ID
        </label>
        <Input
          id="cred-data-access-key"
          type="text"
          placeholder="Access key identifier"
          value={values.access_key}
          onChange={(e) => onChange("access_key", e.target.value)}
          disabled={disabled}
        />
      </div>
      <div>
        <label
          htmlFor="cred-data-secret-key"
          className="mb-1.5 block text-sm font-medium"
        >
          Secret Key
        </label>
        <div className="relative">
          <Input
            id="cred-data-secret-key"
            type={showSecret ? "text" : "password"}
            placeholder="Secret access key"
            value={values.secret_key}
            onChange={(e) => onChange("secret_key", e.target.value)}
            disabled={disabled}
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={onToggleSecretVisibility}
            disabled={disabled}
            title={showSecret ? "Hide secret" : "Show secret"}
          >
            {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Form fields for generic credentials
function GenericFields({
  values,
  onChange,
  disabled,
  showValue,
  onToggleValueVisibility,
}: {
  values: { key: string; value: string };
  onChange: (key: "key" | "value", value: string) => void;
  disabled: boolean;
  showValue: boolean;
  onToggleValueVisibility: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="cred-generic-key"
          className="mb-1.5 block text-sm font-medium"
        >
          Key
        </label>
        <Input
          id="cred-generic-key"
          type="text"
          placeholder="Secret key name"
          value={values.key}
          onChange={(e) => onChange("key", e.target.value)}
          disabled={disabled}
        />
      </div>
      <div>
        <label
          htmlFor="cred-generic-value"
          className="mb-1.5 block text-sm font-medium"
        >
          Value
        </label>
        <div className="relative">
          <Input
            id="cred-generic-value"
            type={showValue ? "text" : "password"}
            placeholder="Secret value"
            value={values.value}
            onChange={(e) => onChange("value", e.target.value)}
            disabled={disabled}
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={onToggleValueVisibility}
            disabled={disabled}
            title={showValue ? "Hide value" : "Show value"}
          >
            {showValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Inline credential form (for new credentials)
function NewCredentialForm({
  formData,
  onChange,
  onSave,
  onCancel,
  isSaving,
  showPassword,
  onTogglePassword,
}: {
  formData: CredentialFormData;
  onChange: (data: CredentialFormData) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
}) {
  const mounted = useMounted();
  const valid = isFormValid(formData);

  const handleTypeChange = useCallback(
    (newType: CredentialType) => {
      onChange({ ...formData, type: newType });
    },
    [formData, onChange],
  );

  const handleRegistryChange = useCallback(
    (key: "url" | "username" | "password", value: string) => {
      onChange({ ...formData, registry: { ...formData.registry, [key]: value } });
    },
    [formData, onChange],
  );

  const handleDataChange = useCallback(
    (key: "endpoint" | "access_key" | "secret_key", value: string) => {
      onChange({ ...formData, data: { ...formData.data, [key]: value } });
    },
    [formData, onChange],
  );

  const handleGenericChange = useCallback(
    (key: "key" | "value", value: string) => {
      onChange({ ...formData, generic: { ...formData.generic, [key]: value } });
    },
    [formData, onChange],
  );

  return (
    <div className="space-y-4 rounded-md border p-4">
      {/* Name field */}
      <div>
        <label
          htmlFor="cred-name"
          className="mb-1.5 block text-sm font-medium"
        >
          Credential Name
        </label>
        <Input
          id="cred-name"
          type="text"
          placeholder="e.g., my-docker-registry"
          value={formData.name}
          onChange={(e) => onChange({ ...formData, name: e.target.value })}
          disabled={isSaving}
        />
      </div>

      {/* Type selector */}
      {mounted && (
        <div>
          <label
            htmlFor="cred-type"
            className="mb-1.5 block text-sm font-medium"
          >
            Credential Type
          </label>
          <Select
            value={formData.type}
            onValueChange={handleTypeChange}
            disabled={isSaving}
          >
            <SelectTrigger
              id="cred-type"
              className="w-full"
            >
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="registry">
                <div className="flex items-center gap-2">
                  <Package className="size-4" />
                  Registry
                </div>
              </SelectItem>
              <SelectItem value="data">
                <div className="flex items-center gap-2">
                  <Database className="size-4" />
                  Data
                </div>
              </SelectItem>
              <SelectItem value="generic">
                <div className="flex items-center gap-2">
                  <Lock className="size-4" />
                  Generic
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Type-specific fields */}
      {formData.type === "registry" && (
        <RegistryFields
          values={formData.registry}
          onChange={handleRegistryChange}
          disabled={isSaving}
          showPassword={showPassword}
          onTogglePasswordVisibility={onTogglePassword}
        />
      )}
      {formData.type === "data" && (
        <DataFields
          values={formData.data}
          onChange={handleDataChange}
          disabled={isSaving}
          showSecret={showPassword}
          onToggleSecretVisibility={onTogglePassword}
        />
      )}
      {formData.type === "generic" && (
        <GenericFields
          values={formData.generic}
          onChange={handleGenericChange}
          disabled={isSaving}
          showValue={showPassword}
          onToggleValueVisibility={onTogglePassword}
        />
      )}

      {/* Form actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="secondary"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          className="bg-nvidia hover:bg-nvidia-dark disabled:opacity-50"
          onClick={onSave}
          disabled={!valid || isSaving}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

// Individual credential item with stage+commit pattern
function CredentialItem({
  credential,
  isExpanded,
  isEditing,
  stagedData,
  isDirty,
  onToggleExpand,
  onStartEdit,
  onDelete,
  onFormChange,
  onSave,
  onReset,
  onCancel,
  isSaving,
  showPassword,
  onTogglePassword,
}: {
  credential: Credential;
  isExpanded: boolean;
  isEditing: boolean;
  stagedData: CredentialFormData | null;
  isDirty: boolean;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
  onFormChange: (data: CredentialFormData) => void;
  onSave: () => void;
  onReset: () => void;
  onCancel: () => void;
  isSaving: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
}) {
  // Get a display value based on credential type
  const displayValue =
    credential.type === "registry"
      ? credential.registry?.url
      : credential.type === "data"
        ? credential.data?.endpoint
        : credential.generic?.key;

  const handleRegistryChange = useCallback(
    (key: "url" | "username" | "password", value: string) => {
      if (!stagedData) return;
      onFormChange({ ...stagedData, registry: { ...stagedData.registry, [key]: value } });
    },
    [stagedData, onFormChange],
  );

  const handleDataChange = useCallback(
    (key: "endpoint" | "access_key" | "secret_key", value: string) => {
      if (!stagedData) return;
      onFormChange({ ...stagedData, data: { ...stagedData.data, [key]: value } });
    },
    [stagedData, onFormChange],
  );

  const handleGenericChange = useCallback(
    (key: "key" | "value", value: string) => {
      if (!stagedData) return;
      onFormChange({ ...stagedData, generic: { ...stagedData.generic, [key]: value } });
    },
    [stagedData, onFormChange],
  );

  const valid = stagedData ? isFormValid(stagedData) : false;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onToggleExpand}
    >
      <div className={cn("overflow-hidden rounded-md border transition-colors", isDirty && "border-nvidia")}>
        {/* Header */}
        <div className="flex w-full items-center justify-between px-4 py-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{credential.name}</span>
            <div className="text-muted-foreground flex items-center gap-3 text-xs">
              <Badge
                variant="outline"
                className="rounded font-mono text-[0.6875rem] tracking-wide uppercase"
              >
                {credential.type}
              </Badge>
              {displayValue && <span>{displayValue}</span>}
              <span className="text-muted-foreground">{formatRelativeTime(credential.updated_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Edit credential"
                  onClick={() => {
                    if (!isExpanded) {
                      onStartEdit();
                      onToggleExpand();
                    }
                  }}
                  disabled={isSaving}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Delete credential"
                  className="text-destructive hover:text-destructive"
                  onClick={onDelete}
                  disabled={isSaving}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Expanded content - only show fields if editing */}
        <CollapsibleContent>
          {isExpanded && isEditing && stagedData && (
            <div className="space-y-4 border-t px-4 py-4">
              {/* Type-specific fields */}
              {stagedData.type === "registry" && (
                <RegistryFields
                  values={stagedData.registry}
                  onChange={handleRegistryChange}
                  disabled={isSaving}
                  showPassword={showPassword}
                  onTogglePasswordVisibility={onTogglePassword}
                />
              )}
              {stagedData.type === "data" && (
                <DataFields
                  values={stagedData.data}
                  onChange={handleDataChange}
                  disabled={isSaving}
                  showSecret={showPassword}
                  onToggleSecretVisibility={onTogglePassword}
                />
              )}
              {stagedData.type === "generic" && (
                <GenericFields
                  values={stagedData.generic}
                  onChange={handleGenericChange}
                  disabled={isSaving}
                  showValue={showPassword}
                  onToggleValueVisibility={onTogglePassword}
                />
              )}

              {/* Cancel/Reset/Save buttons */}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  onClick={onCancel}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  onClick={onReset}
                  disabled={!isDirty || isSaving}
                >
                  Reset
                </Button>
                <Button
                  className="bg-nvidia hover:bg-nvidia-dark disabled:opacity-50"
                  onClick={onSave}
                  disabled={!valid || !isDirty || isSaving}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// Delete confirmation dialog
function DeleteConfirmDialog({
  open,
  credentialName,
  onConfirm,
  onCancel,
  isDeleting,
}: {
  open: boolean;
  credentialName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}) {
  const mounted = useMounted();

  // Guard against SSR - Dialog uses Radix which generates different IDs server/client
  if (!mounted) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => !isOpen && onCancel()}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete Credential</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete the credential &quot;{credentialName}&quot;? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Main Component
// =============================================================================

interface CredentialsCardProps {
  credentials: Credential[];
}

export function CredentialsCard({ credentials }: CredentialsCardProps) {
  const { announcer } = useServices();
  const { mutateAsync: upsertCredential, isPending: isUpserting } = useUpsertCredential();
  const { mutateAsync: deleteCredential, isPending: isDeleting } = useDeleteCredential();

  // State for new credential form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newFormData, setNewFormData] = useState<CredentialFormData | null>(null);

  // State for editing existing credentials (stage+commit pattern)
  const [credentialEdits, setCredentialEdits] = useState<CredentialEdits>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  // Password visibility state (per credential)
  const [passwordVisibility, setPasswordVisibility] = useState<{ [key: string]: boolean }>({});

  // Delete confirmation state
  const [deleteConfirmName, setDeleteConfirmName] = useState<string | null>(null);

  // Group credentials by type
  const grouped = useMemo(() => groupCredentialsByType(credentials), [credentials]);

  // Handlers for new credential
  const handleAddNew = useCallback(() => {
    setShowNewForm(true);
    setNewFormData(createEmptyFormData());
  }, []);

  const handleCancelNew = useCallback(() => {
    setShowNewForm(false);
    setNewFormData(null);
  }, []);

  const handleSaveNew = useCallback(async () => {
    if (!newFormData) return;
    if (!isFormValid(newFormData)) return;

    try {
      await upsertCredential(formDataToCredentialCreate(newFormData));
      announcer.announce(`Credential "${newFormData.name}" created successfully`, "polite");
      setShowNewForm(false);
      setNewFormData(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create credential";
      announcer.announce(`Error: ${message}`, "assertive");
    }
  }, [newFormData, upsertCredential, announcer]);

  // Handlers for expanding/collapsing
  const handleToggleExpand = useCallback((credentialId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(credentialId)) {
        next.delete(credentialId);
      } else {
        next.add(credentialId);
      }
      return next;
    });
  }, []);

  // Handlers for editing (stage+commit)
  const handleStartEdit = useCallback((credential: Credential) => {
    setEditingIds((prev) => new Set(prev).add(credential.id));
    setCredentialEdits((prev) => ({
      ...prev,
      [credential.id]: createFormDataFromCredential(credential),
    }));
  }, []);

  const handleFormChange = useCallback((credentialId: string, data: CredentialFormData) => {
    setCredentialEdits((prev) => ({
      ...prev,
      [credentialId]: data,
    }));
  }, []);

  const handleSaveEdit = useCallback(
    async (credentialId: string) => {
      const formData = credentialEdits[credentialId];
      if (!formData || !isFormValid(formData)) return;

      try {
        await upsertCredential(formDataToCredentialCreate(formData));
        announcer.announce(`Credential "${formData.name}" updated successfully`, "polite");
        // Clear editing state after successful save
        setEditingIds((prev) => {
          const next = new Set(prev);
          next.delete(credentialId);
          return next;
        });
        setCredentialEdits((prev) => {
          const next = { ...prev };
          delete next[credentialId];
          return next;
        });
        // Collapse the credential
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(credentialId);
          return next;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update credential";
        announcer.announce(`Error: ${message}`, "assertive");
      }
    },
    [credentialEdits, upsertCredential, announcer],
  );

  const handleResetEdit = useCallback(
    (credentialId: string) => {
      const credential = credentials.find((c) => c.id === credentialId);
      if (!credential) return;
      setCredentialEdits((prev) => ({
        ...prev,
        [credentialId]: createFormDataFromCredential(credential),
      }));
    },
    [credentials],
  );

  const handleCancelEdit = useCallback((credentialId: string) => {
    // Clear editing state
    setEditingIds((prev) => {
      const next = new Set(prev);
      next.delete(credentialId);
      return next;
    });
    // Clear edits
    setCredentialEdits((prev) => {
      const next = { ...prev };
      delete next[credentialId];
      return next;
    });
    // Collapse the credential
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(credentialId);
      return next;
    });
  }, []);

  // Handlers for deleting credential
  const handleStartDelete = useCallback((credentialName: string) => {
    setDeleteConfirmName(credentialName);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmName(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirmName) return;

    try {
      await deleteCredential(deleteConfirmName);
      announcer.announce(`Credential "${deleteConfirmName}" deleted successfully`, "polite");
      setDeleteConfirmName(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete credential";
      announcer.announce(`Error: ${message}`, "assertive");
    }
  }, [deleteConfirmName, deleteCredential, announcer]);

  // Password visibility toggles
  const handleTogglePassword = useCallback((key: string) => {
    setPasswordVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // Check if credential has unsaved edits
  const isCredentialDirty = useCallback(
    (credentialId: string): boolean => {
      const credential = credentials.find((c) => c.id === credentialId);
      if (!credential) return false;
      const edit = credentialEdits[credentialId];
      if (!edit) return false;

      const original = createFormDataFromCredential(credential);
      return JSON.stringify(original) !== JSON.stringify(edit);
    },
    [credentials, credentialEdits],
  );

  const isMutating = isUpserting || isDeleting;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Key className="size-5" />
          Credentials
          <Badge
            variant="secondary"
            className="bg-nvidia-bg text-nvidia-dark ml-1 text-xs"
          >
            {credentials.length} total
          </Badge>
        </CardTitle>
        <CardDescription>
          Manage credentials for container registries, data storage, and generic secrets. Click a credential to expand,
          then click Edit to modify.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* New Credential Button / Form */}
        <div className="mb-6">
          {showNewForm && newFormData ? (
            <NewCredentialForm
              formData={newFormData}
              onChange={setNewFormData}
              onSave={handleSaveNew}
              onCancel={handleCancelNew}
              isSaving={isUpserting}
              showPassword={passwordVisibility["__new__"] ?? false}
              onTogglePassword={() => handleTogglePassword("__new__")}
            />
          ) : (
            <Button
              variant="outline"
              className="border-border hover:border-nvidia w-full justify-center gap-2 border-dashed py-3"
              onClick={handleAddNew}
              disabled={isMutating}
            >
              <Plus className="size-4" />
              New Credential
            </Button>
          )}
        </div>

        {/* Credentials List */}
        {credentials.length === 0 ? (
          <p className="text-muted-foreground text-sm">No credentials configured</p>
        ) : (
          <div className="space-y-8">
            {/* Registry Credentials */}
            {grouped.registry.length > 0 && (
              <div>
                <CredentialSectionHeader
                  icon={Package}
                  title="Registry Credentials"
                />
                <div className="space-y-2">
                  {grouped.registry.map((cred: Credential) => (
                    <CredentialItem
                      key={cred.id}
                      credential={cred}
                      isExpanded={expandedIds.has(cred.id)}
                      isEditing={editingIds.has(cred.id)}
                      stagedData={credentialEdits[cred.id] ?? null}
                      isDirty={isCredentialDirty(cred.id)}
                      onToggleExpand={() => handleToggleExpand(cred.id)}
                      onStartEdit={() => handleStartEdit(cred)}
                      onDelete={() => handleStartDelete(cred.name)}
                      onFormChange={(data) => handleFormChange(cred.id, data)}
                      onSave={() => handleSaveEdit(cred.id)}
                      onReset={() => handleResetEdit(cred.id)}
                      onCancel={() => handleCancelEdit(cred.id)}
                      isSaving={isUpserting}
                      showPassword={passwordVisibility[cred.id] ?? false}
                      onTogglePassword={() => handleTogglePassword(cred.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Data Credentials */}
            {grouped.data.length > 0 && (
              <div>
                <CredentialSectionHeader
                  icon={Database}
                  title="Data Credentials"
                />
                <div className="space-y-2">
                  {grouped.data.map((cred: Credential) => (
                    <CredentialItem
                      key={cred.id}
                      credential={cred}
                      isExpanded={expandedIds.has(cred.id)}
                      isEditing={editingIds.has(cred.id)}
                      stagedData={credentialEdits[cred.id] ?? null}
                      isDirty={isCredentialDirty(cred.id)}
                      onToggleExpand={() => handleToggleExpand(cred.id)}
                      onStartEdit={() => handleStartEdit(cred)}
                      onDelete={() => handleStartDelete(cred.name)}
                      onFormChange={(data) => handleFormChange(cred.id, data)}
                      onSave={() => handleSaveEdit(cred.id)}
                      onReset={() => handleResetEdit(cred.id)}
                      onCancel={() => handleCancelEdit(cred.id)}
                      isSaving={isUpserting}
                      showPassword={passwordVisibility[cred.id] ?? false}
                      onTogglePassword={() => handleTogglePassword(cred.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Generic Credentials */}
            {grouped.generic.length > 0 && (
              <div>
                <CredentialSectionHeader
                  icon={Lock}
                  title="Generic Credentials"
                />
                <div className="space-y-2">
                  {grouped.generic.map((cred: Credential) => (
                    <CredentialItem
                      key={cred.id}
                      credential={cred}
                      isExpanded={expandedIds.has(cred.id)}
                      isEditing={editingIds.has(cred.id)}
                      stagedData={credentialEdits[cred.id] ?? null}
                      isDirty={isCredentialDirty(cred.id)}
                      onToggleExpand={() => handleToggleExpand(cred.id)}
                      onStartEdit={() => handleStartEdit(cred)}
                      onDelete={() => handleStartDelete(cred.name)}
                      onFormChange={(data) => handleFormChange(cred.id, data)}
                      onSave={() => handleSaveEdit(cred.id)}
                      onReset={() => handleResetEdit(cred.id)}
                      onCancel={() => handleCancelEdit(cred.id)}
                      isSaving={isUpserting}
                      showPassword={passwordVisibility[cred.id] ?? false}
                      onTogglePassword={() => handleTogglePassword(cred.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteConfirmName !== null}
        credentialName={deleteConfirmName ?? ""}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isDeleting={isDeleting}
      />
    </Card>
  );
}
