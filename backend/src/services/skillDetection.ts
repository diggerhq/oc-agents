/**
 * Skill Detection Service
 * 
 * Detects and loads skill-related folders from file buckets.
 * This works with ANY bucket (manual uploads or repo-backed).
 * 
 * Detected patterns:
 * - Skills: claude/skills/*.md, .cursorrules, AGENTS.md, CLAUDE.md
 * - Tools: claude/tools/*.sh, claude/tools/*.py
 * - Prompts: claude/prompts/*.md
 */

import Anthropic from '@anthropic-ai/sdk';
import { query, queryOne } from '../db/index.js';
import { downloadFromR2 } from './storage.js';
import type { DetectedSkillFolders } from '../types/index.js';

// Initialize Anthropic client for skill name generation
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// File patterns that indicate skill-related content
// Only ROOT-LEVEL patterns are supported - no wildcards that match nested directories
const SKILL_FILE_PATTERNS = [
  // Root-level skill files (at bucket root)
  { pattern: /^\/\.cursorrules$/i, type: 'skills' as const },
  { pattern: /^\/agents\.md$/i, type: 'skills' as const },
  { pattern: /^\/claude\.md$/i, type: 'skills' as const },
  { pattern: /^\/skills\.md$/i, type: 'skills' as const },

  // Root-level skill files by extension (uploaded via wizard)
  { pattern: /^\/[^\/]+\.md$/i, type: 'skills' as const },
  { pattern: /^\/[^\/]+\.mdc$/i, type: 'skills' as const },
  { pattern: /^\/[^\/]+\.skill$/i, type: 'skills' as const },
  { pattern: /^\/[^\/]+\.txt$/i, type: 'skills' as const },

  // Skill folders uploaded to root: /my-skill/SKILL.md, /my-skill/instruction.md
  { pattern: /^\/[^\/]+\/skill\.md$/i, type: 'skills' as const },
  { pattern: /^\/[^\/]+\/instruction\.md$/i, type: 'skills' as const },

  // Skills folder at root: /skills/*.md, /skills/*.skill
  { pattern: /^\/skills\/[^\/]+\.(md|mdc|skill)$/i, type: 'skills' as const },

  // Claude folder at root: /claude/skills/*.md or /.claude/skills/*.md
  { pattern: /^\/\.?claude\/skills\/[^\/]+\.(md|mdc|skill)$/i, type: 'skills' as const },
  { pattern: /^\/\.?claude\/tools\/[^\/]+\.(sh|py|ts|js)$/i, type: 'tools' as const },
  { pattern: /^\/\.?claude\/prompts\/[^\/]+\.md$/i, type: 'prompts' as const },
  // Claude nested skill folders: /.claude/skills/my-skill/instruction.md
  { pattern: /^\/\.claude\/skills\/[^\/]+\/instruction\.md$/i, type: 'skills' as const },

  // Cursor folder at root: /cursor/skills/*.md
  { pattern: /^\/cursor\/skills\/[^\/]+\.(md|mdc|skill)$/i, type: 'skills' as const },
  { pattern: /^\/cursor\/prompts\/[^\/]+\.md$/i, type: 'prompts' as const },

  // AI folder at root: /ai/skills/*.md
  { pattern: /^\/ai\/skills\/[^\/]+\.(md|mdc|skill)$/i, type: 'skills' as const },
  { pattern: /^\/ai\/tools\/[^\/]+\.(sh|py|ts|js)$/i, type: 'tools' as const },
  { pattern: /^\/ai\/prompts\/[^\/]+\.md$/i, type: 'prompts' as const },

  // Amp (.agents): /.agents/skills/*.md and /.agents/skills/my-skill/instruction.md
  { pattern: /^\/\.agents\/skills\/[^\/]+\.(md|mdc|skill)$/i, type: 'skills' as const },
  { pattern: /^\/\.agents\/skills\/[^\/]+\/instruction\.md$/i, type: 'skills' as const },

  // Codex (.codex): /.codex/system.md and /.codex/skills/*.md
  { pattern: /^\/\.codex\/system\.md$/i, type: 'skills' as const },
  { pattern: /^\/\.codex\/skills\/[^\/]+\.(md|mdc|skill)$/i, type: 'skills' as const },
];

interface FileRecord {
  id: string;
  path: string;
  name: string;
  storage_key: string | null;
  is_folder: boolean | number;
}

interface SkillFile {
  path: string;
  type: 'skills' | 'tools' | 'prompts';
  content?: string;
}

/**
 * Detect skill folders from a list of file paths
 * Paths should start with / (e.g., /skills/review.md)
 */
export function detectSkillFolders(paths: string[]): DetectedSkillFolders {
  const detected: DetectedSkillFolders = {
    skills: [],
    tools: [],
    prompts: [],
  };
  
  for (const filePath of paths) {
    // Ensure path starts with / for pattern matching
    const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    
    for (const { pattern, type } of SKILL_FILE_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        detected[type].push(filePath);
        break; // Only match first pattern
      }
    }
  }
  
  // Sort each array for consistent ordering
  detected.skills.sort();
  detected.tools.sort();
  detected.prompts.sort();
  
  return detected;
}

/**
 * Scan a single bucket for skill files
 */
export async function scanBucketForSkills(bucketId: string): Promise<DetectedSkillFolders> {
  const files = await query<FileRecord>(
    'SELECT id, path, name, storage_key, is_folder FROM files WHERE bucket_id = $1 AND is_folder = $2',
    [bucketId, false]
  );
  
  const paths = files.map(f => f.path);
  return detectSkillFolders(paths);
}

/**
 * Scan all buckets attached to an agent for skill files
 */
export async function scanAgentBucketsForSkills(sessionId: string): Promise<{
  detectedFolders: DetectedSkillFolders;
  bucketSkills: Array<{
    bucketId: string;
    bucketName: string;
    skills: DetectedSkillFolders;
  }>;
}> {
  // Get all attached buckets
  const attachedBuckets = await query<{ bucket_id: string; bucket_name: string }>(
    `SELECT ab.bucket_id, b.name as bucket_name 
     FROM agent_buckets ab 
     JOIN buckets b ON ab.bucket_id = b.id 
     WHERE ab.session_id = $1`,
    [sessionId]
  );
  
  const allDetected: DetectedSkillFolders = {
    skills: [],
    tools: [],
    prompts: [],
  };
  
  const bucketSkills: Array<{
    bucketId: string;
    bucketName: string;
    skills: DetectedSkillFolders;
  }> = [];
  
  for (const bucket of attachedBuckets) {
    const detected = await scanBucketForSkills(bucket.bucket_id);
    
    bucketSkills.push({
      bucketId: bucket.bucket_id,
      bucketName: bucket.bucket_name,
      skills: detected,
    });
    
    // Merge into all detected
    allDetected.skills.push(...detected.skills);
    allDetected.tools.push(...detected.tools);
    allDetected.prompts.push(...detected.prompts);
  }
  
  return { detectedFolders: allDetected, bucketSkills };
}

/**
 * Load skill file contents from a bucket
 */
export async function loadSkillFilesFromBucket(
  bucketId: string,
  userId: string
): Promise<SkillFile[]> {
  const detected = await scanBucketForSkills(bucketId);
  const allPaths = [...detected.skills, ...detected.tools, ...detected.prompts];
  
  if (allPaths.length === 0) {
    return [];
  }
  
  const skillFiles: SkillFile[] = [];
  
  for (const path of allPaths) {
    const file = await queryOne<FileRecord>(
      'SELECT id, path, name, storage_key FROM files WHERE bucket_id = $1 AND path = $2 AND is_folder = $3',
      [bucketId, path, false]
    );
    
    if (file?.storage_key) {
      try {
        const result = await downloadFromR2(file.storage_key, userId);
        if (result.success && result.content) {
          const content = result.content.toString('utf8');
          
          // Determine type
          let type: 'skills' | 'tools' | 'prompts' = 'skills';
          if (detected.tools.includes(path)) type = 'tools';
          else if (detected.prompts.includes(path)) type = 'prompts';
          
          skillFiles.push({
            path,
            type,
            content,
          });
        }
      } catch (err) {
        console.error(`[SkillDetection] Failed to load ${path}:`, err);
      }
    }
  }
  
  return skillFiles;
}

/**
 * Load all skill files from all buckets attached to an agent
 */
export async function loadAgentSkillFiles(
  sessionId: string,
  userId: string
): Promise<{
  skillFiles: SkillFile[];
  summary: DetectedSkillFolders;
}> {
  // Get all attached buckets
  const attachedBuckets = await query<{ bucket_id: string }>(
    'SELECT bucket_id FROM agent_buckets WHERE session_id = $1',
    [sessionId]
  );
  
  const allSkillFiles: SkillFile[] = [];
  const summary: DetectedSkillFolders = {
    skills: [],
    tools: [],
    prompts: [],
  };
  
  for (const bucket of attachedBuckets) {
    const files = await loadSkillFilesFromBucket(bucket.bucket_id, userId);
    allSkillFiles.push(...files);
    
    // Add to summary
    for (const file of files) {
      summary[file.type].push(file.path);
    }
  }
  
  return { skillFiles: allSkillFiles, summary };
}

/**
 * Generate a system prompt addition based on detected skill files
 */
export function generateSkillPromptAddition(skillFiles: SkillFile[]): string {
  if (skillFiles.length === 0) {
    return '';
  }
  
  const skills = skillFiles.filter(f => f.type === 'skills');
  const tools = skillFiles.filter(f => f.type === 'tools');
  const prompts = skillFiles.filter(f => f.type === 'prompts');
  
  let addition = '\n\n# Loaded Skills & Instructions\n\n';
  
  if (skills.length > 0) {
    addition += '## Skills\n\n';
    for (const skill of skills) {
      addition += `### ${skill.path}\n\n${skill.content}\n\n`;
    }
  }
  
  if (prompts.length > 0) {
    addition += '## Prompt Templates\n\n';
    for (const prompt of prompts) {
      addition += `### ${prompt.path}\n\n${prompt.content}\n\n`;
    }
  }
  
  if (tools.length > 0) {
    addition += '## Available Tools\n\n';
    addition += 'The following tool scripts are available in your workspace:\n';
    for (const tool of tools) {
      addition += `- \`${tool.path}\`\n`;
    }
    addition += '\nYou can execute these tools using the run_command tool.\n';
  }
  
  return addition;
}

/**
 * Generate a friendly display name for a skill file using AI
 * Takes the first ~500 chars of the skill content and asks Claude to create
 * a short, descriptive title (like ChatGPT thread titles)
 */
export async function generateSkillFriendlyName(
  filename: string,
  content: string
): Promise<string> {
  try {
    // Skip if no API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[Skills] No ANTHROPIC_API_KEY, using filename as display name');
      return filename.replace(/\.(md|mdc|skill|txt|json)$/i, '').replace(/[-_]/g, ' ');
    }

    // Take first ~500 chars of content for context
    const contentPreview = content.slice(0, 500);
    
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-20250514', // Fast model for title generation
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `Generate a short, friendly 2-4 word title for this AI skill/instruction file. Make it descriptive and human-readable, like a ChatGPT conversation title.

Filename: ${filename}

Content preview:
${contentPreview}

Respond with ONLY the title, no quotes or explanation.`
      }]
    });

    const title = response.content[0].type === 'text' 
      ? response.content[0].text.trim()
      : filename.replace(/\.(md|mdc|skill|txt|json)$/i, '').replace(/[-_]/g, ' ');
    
    console.log(`[Skills] Generated friendly name for ${filename}: "${title}"`);
    return title;
  } catch (error) {
    console.error(`[Skills] Failed to generate friendly name for ${filename}:`, error);
    // Fallback to filename-based title
    return filename.replace(/\.(md|mdc|skill|txt|json)$/i, '').replace(/[-_]/g, ' ');
  }
}
