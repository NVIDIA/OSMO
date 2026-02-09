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
import { toast } from "sonner";
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
import { Key, Database, Lock, Package, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { useServices } from "@/contexts";
import { useMounted } from "@/hooks";
import { useUpsertCredential, useDeleteCredential } from "@/lib/api/adapter";
import type { Credential, CredentialCreate } from "@/lib/api/adapter";

// =============================================================================
// Types
// =============================================================================

type CredentialType = "REGISTRY" | "DATA" | "GENERIC";

interface CredentialFormData {
  name: string;
  type: CredentialType;
  registry: { url: string; username: string; password: string };
  data: { endpoint: string; access_key: string; secret_key: string };
  generic: Array<{ key: string; value: string }>;
}

// =============================================================================
// Utility Functions
// =============================================================================

function createEmptyFormData(): CredentialFormData {
  return {
    name: "",
    type: "REGISTRY",
    registry: { url: "", username: "", password: "" },
    data: { endpoint: "", access_key: "", secret_key: "" },
    generic: [{ key: "", value: "" }],
  };
}

function formDataToCredentialCreate(formData: CredentialFormData): CredentialCreate {
  const base = { cred_name: formData.name };

  if (formData.type === "REGISTRY") {
    return {
      ...base,
      registry_credential: {
        registry: formData.registry.url,
        username: formData.registry.username,
        auth: formData.registry.password, // Backend expects 'auth' field
      },
    };
  } else if (formData.type === "DATA") {
    return {
      ...base,
      data_credential: {
        endpoint: formData.data.endpoint,
        access_key_id: formData.data.access_key,
        access_key: formData.data.secret_key,
      },
    };
  } else {
    // Convert array of key-value pairs to a single record
    const credential: Record<string, string> = {};
    for (const pair of formData.generic) {
      credential[pair.key] = pair.value;
    }
    return {
      ...base,
      generic_credential: {
        credential,
      },
    };
  }
}

function isFormValid(formData: CredentialFormData): boolean {
  if (!formData.name.trim()) return false;

  if (formData.type === "REGISTRY") {
    return !!(formData.registry.url.trim() && formData.registry.username.trim() && formData.registry.password.trim());
  } else if (formData.type === "DATA") {
    return !!(formData.data.endpoint.trim() && formData.data.access_key.trim() && formData.data.secret_key.trim());
  } else {
    // For generic, all pairs must have non-empty keys and values
    return formData.generic.length > 0 && formData.generic.every((pair) => pair.key.trim() && pair.value.trim());
  }
}

// Group credentials by type for organized display
function groupCredentialsByType(credentials: Credential[]) {
  const registry: Credential[] = [];
  const data: Credential[] = [];
  const generic: Credential[] = [];

  for (const cred of credentials) {
    if (cred.cred_type === "REGISTRY") {
      registry.push(cred);
    } else if (cred.cred_type === "DATA") {
      data.push(cred);
    } else {
      generic.push(cred);
    }
  }

  return { registry, data, generic };
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

// Form fields for generic credentials (supports multiple key-value pairs)
function GenericFields({
  values,
  onChange,
  disabled,
  showValue,
  onToggleValueVisibility,
}: {
  values: Array<{ key: string; value: string }>;
  onChange: (pairs: Array<{ key: string; value: string }>) => void;
  disabled: boolean;
  showValue: boolean;
  onToggleValueVisibility: () => void;
}) {
  const handlePairChange = useCallback(
    (index: number, field: "key" | "value", value: string) => {
      const newPairs = [...values];
      newPairs[index] = { ...newPairs[index], [field]: value };
      onChange(newPairs);
    },
    [values, onChange],
  );

  const handleAddPair = useCallback(() => {
    onChange([...values, { key: "", value: "" }]);
  }, [values, onChange]);

  const handleRemovePair = useCallback(
    (index: number) => {
      if (values.length === 1) return; // Keep at least one pair
      const newPairs = values.filter((_, i) => i !== index);
      onChange(newPairs);
    },
    [values, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium">Key-Value Pairs</label>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleValueVisibility}
          disabled={disabled}
          title={showValue ? "Hide values" : "Show values"}
        >
          {showValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </div>
      {values.map((pair, index) => (
        <div
          key={index}
          className="flex items-center gap-2"
        >
          <Input
            type="text"
            placeholder="Key"
            value={pair.key}
            onChange={(e) => handlePairChange(index, "key", e.target.value)}
            disabled={disabled}
            className="flex-1"
          />
          <Input
            type={showValue ? "text" : "password"}
            placeholder="Value"
            value={pair.value}
            onChange={(e) => handlePairChange(index, "value", e.target.value)}
            disabled={disabled}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => handleRemovePair(index)}
            disabled={disabled || values.length === 1}
            title={values.length === 1 ? "At least one pair required" : "Remove pair"}
            className="text-muted-foreground hover:text-destructive disabled:opacity-30"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleAddPair}
          disabled={disabled}
          title="Add another pair"
        >
          <Plus className="size-4" />
        </Button>
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
    (pairs: Array<{ key: string; value: string }>) => {
      onChange({ ...formData, generic: pairs });
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
              <SelectItem value="REGISTRY">
                <div className="flex items-center gap-2">
                  <Package className="size-4" />
                  Registry
                </div>
              </SelectItem>
              <SelectItem value="DATA">
                <div className="flex items-center gap-2">
                  <Database className="size-4" />
                  Data
                </div>
              </SelectItem>
              <SelectItem value="GENERIC">
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
      {formData.type === "REGISTRY" && (
        <RegistryFields
          values={formData.registry}
          onChange={handleRegistryChange}
          disabled={isSaving}
          showPassword={showPassword}
          onTogglePasswordVisibility={onTogglePassword}
        />
      )}
      {formData.type === "DATA" && (
        <DataFields
          values={formData.data}
          onChange={handleDataChange}
          disabled={isSaving}
          showSecret={showPassword}
          onToggleSecretVisibility={onTogglePassword}
        />
      )}
      {formData.type === "GENERIC" && (
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

// Individual credential item (read-only display with delete option)
function CredentialItem({
  credential,
  onDelete,
  isSaving,
}: {
  credential: Credential;
  onDelete: () => void;
  isSaving: boolean;
}) {
  // Get display value from profile field (URL/endpoint for registry/data, null for generic)
  const displayValue = credential.profile;

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex w-full items-center justify-between px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{credential.cred_name}</span>
          {displayValue && (
            <div className="text-muted-foreground text-xs">
              <span>{displayValue}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>
    </div>
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

  // Password visibility state for new credential form
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
      toast.success(`Credential "${newFormData.name}" created successfully`);
      announcer.announce(`Credential "${newFormData.name}" created successfully`, "polite");
      setShowNewForm(false);
      setNewFormData(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create credential";
      toast.error(message);
      announcer.announce(`Error: ${message}`, "assertive");
    }
  }, [newFormData, upsertCredential, announcer]);

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
      toast.success(`Credential "${deleteConfirmName}" deleted successfully`);
      announcer.announce(`Credential "${deleteConfirmName}" deleted successfully`, "polite");
      setDeleteConfirmName(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete credential";
      toast.error(message);
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
          Manage credentials for container registries, data storage, and generic secrets. Credentials cannot be edited -
          delete and recreate to update.
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
            {/* Registry */}
            {grouped.registry.length > 0 && (
              <div>
                <CredentialSectionHeader
                  icon={Package}
                  title="Registry"
                />
                <div className="space-y-2">
                  {grouped.registry.map((cred: Credential) => (
                    <CredentialItem
                      key={cred.cred_name}
                      credential={cred}
                      onDelete={() => handleStartDelete(cred.cred_name)}
                      isSaving={isMutating}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Data */}
            {grouped.data.length > 0 && (
              <div>
                <CredentialSectionHeader
                  icon={Database}
                  title="Data"
                />
                <div className="space-y-2">
                  {grouped.data.map((cred: Credential) => (
                    <CredentialItem
                      key={cred.cred_name}
                      credential={cred}
                      onDelete={() => handleStartDelete(cred.cred_name)}
                      isSaving={isMutating}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Generic */}
            {grouped.generic.length > 0 && (
              <div>
                <CredentialSectionHeader
                  icon={Lock}
                  title="Generic"
                />
                <div className="space-y-2">
                  {grouped.generic.map((cred: Credential) => (
                    <CredentialItem
                      key={cred.cred_name}
                      credential={cred}
                      onDelete={() => handleStartDelete(cred.cred_name)}
                      isSaving={isMutating}
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
