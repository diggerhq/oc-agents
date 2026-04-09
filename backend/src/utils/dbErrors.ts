/**
 * Database error handling utilities
 * Converts database constraint violations into user-friendly error messages
 */

export interface DbError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
}

export interface UserFriendlyError {
  message: string;
  field?: string;
  code: string;
}

/**
 * Check if an error is a database constraint violation
 */
export function isConstraintViolation(error: any): boolean {
  return error?.code === '23505' || error?.code === 'SQLITE_CONSTRAINT';
}

/**
 * Check if an error is a foreign key violation
 */
export function isForeignKeyViolation(error: any): boolean {
  return error?.code === '23503' || error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY';
}

/**
 * Convert database constraint error to user-friendly message
 */
export function handleConstraintError(error: DbError, resourceType: string): UserFriendlyError {
  const constraint = error.constraint || '';
  const detail = error.detail || '';
  
  // Extract field name from constraint or detail
  let field: string | undefined;
  let message: string;
  
  // Handle unique constraint violations
  if (constraint.includes('_name_key') || constraint.includes('user_id_name') || constraint.includes('org_user_name')) {
    field = 'name';
    message = `A ${resourceType} with this name already exists in this workspace. Please choose a different name.`;
  } else if (constraint.includes('_slug_key') || detail.includes('slug')) {
    field = 'slug';
    message = `This ${resourceType} identifier is already taken. Please try a different name.`;
  } else if (constraint.includes('_email_key') || detail.includes('email')) {
    field = 'email';
    message = 'This email address is already registered.';
  } else if (constraint.includes('session_id_bucket_id') || constraint.includes('agent_buckets')) {
    field = 'bucket';
    message = 'This file bucket is already attached to this agent.';
  } else if (constraint.includes('session_id_knowledge_base_id')) {
    field = 'knowledge_base';
    message = 'This knowledge base is already attached to this agent.';
  } else if (constraint.includes('workflow_id_bucket_id')) {
    field = 'bucket';
    message = 'This file bucket is already attached to this workflow.';
  } else if (constraint.includes('session_id_user_id')) {
    field = 'user';
    message = 'This user already has access to this agent.';
  } else if (constraint.includes('organization_id_user_id')) {
    field = 'user';
    message = 'This user is already a member of this organization.';
  } else {
    // Generic constraint violation
    message = `This ${resourceType} already exists or conflicts with an existing record. Please modify your input and try again.`;
  }
  
  return {
    message,
    field,
    code: 'DUPLICATE_RESOURCE',
  };
}

/**
 * Wrap database operations with constraint error handling
 */
export async function withConstraintHandling<T>(
  operation: () => Promise<T>,
  resourceType: string
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (isConstraintViolation(error)) {
      const friendlyError = handleConstraintError(error, resourceType);
      const err = new Error(friendlyError.message) as any;
      err.code = friendlyError.code;
      err.field = friendlyError.field;
      err.statusCode = 409; // Conflict
      throw err;
    }
    throw error;
  }
}

/**
 * Handle foreign key violation errors
 */
export function handleForeignKeyError(error: DbError, resourceType: string): UserFriendlyError {
  const detail = error.detail || '';
  const constraint = error.constraint || '';
  
  // Try to extract the referenced table/resource
  let referencedResource = 'other resources';
  
  if (detail.includes('agent_buckets') || constraint.includes('agent_buckets')) {
    referencedResource = 'agents';
  } else if (detail.includes('workflow_buckets') || constraint.includes('workflow_buckets')) {
    referencedResource = 'workflows';
  } else if (detail.includes('knowledge_bases') || constraint.includes('knowledge_bases')) {
    referencedResource = 'knowledge bases';
  } else if (detail.includes('organization_members') || constraint.includes('organization_members')) {
    referencedResource = 'organization members';
  }
  
  return {
    message: `Cannot delete this ${resourceType} because it is still being used by ${referencedResource}. Please remove those references first.`,
    code: 'RESOURCE_IN_USE',
  };
}

/**
 * Express error handler middleware for database errors
 */
export function dbErrorHandler(err: any, req: any, res: any, next: any) {
  if (err.code === 'DUPLICATE_RESOURCE') {
    return res.status(409).json({
      error: err.message,
      field: err.field,
      code: err.code,
    });
  }
  
  if (err.code === 'RESOURCE_IN_USE') {
    return res.status(409).json({
      error: err.message,
      code: err.code,
    });
  }
  
  // Check if it's an unhandled constraint violation
  if (isConstraintViolation(err)) {
    const friendlyError = handleConstraintError(err, 'resource');
    return res.status(409).json({
      error: friendlyError.message,
      field: friendlyError.field,
      code: friendlyError.code,
    });
  }
  
  // Check if it's a foreign key violation
  if (isForeignKeyViolation(err)) {
    const friendlyError = handleForeignKeyError(err, 'resource');
    return res.status(409).json({
      error: friendlyError.message,
      code: friendlyError.code,
    });
  }
  
  next(err);
}
