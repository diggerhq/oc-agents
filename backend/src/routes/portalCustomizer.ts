/**
 * Portal Customizer - AI-powered portal styling from website URLs
 * 
 * Analyzes a website's design and generates 3 matching portal theme options.
 * Creates visual previews and has AI self-review before presenting to user.
 * Uses ScreenshotOne API for server-side screenshot capture.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, execute } from '../db/index.js';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ThemeOption {
  id: string;
  name: string;
  description: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  borderRadius: string;
  customCSS: string;
  previewImage?: string; // Base64 preview
  aiScore?: number; // 1-10 score from AI review
  aiNotes?: string; // AI review notes
}

interface AnalysisStage {
  stage: string;
  status: 'pending' | 'in_progress' | 'complete' | 'error';
  message: string;
}

// Helper to send SSE events
function sendStageUpdate(res: Response, stage: string, status: string, message: string) {
  res.write(`data: ${JSON.stringify({ type: 'stage', stage, status, message })}\n\n`);
}

/**
 * POST /api/portal-customizer/analyze
 * Analyze a website and generate 3 portal theme options with AI review.
 * Uses Server-Sent Events to stream progress stages.
 */
router.post('/analyze', requireAuth, async (req: Request, res: Response) => {
  const { url, sessionId } = req.body;
  const userId = req.session.userId!;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    if (!url) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'URL is required' })}\n\n`);
      return res.end();
    }

    if (!sessionId) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Session ID is required' })}\n\n`);
      return res.end();
    }

    // Verify session belongs to user
    const session = await queryOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (!session) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Agent not found' })}\n\n`);
      return res.end();
    }

    console.log(`[PortalCustomizer] Analyzing ${url} for session ${sessionId}`);

    // ========== STAGE 1: Capture Website Screenshot ==========
    sendStageUpdate(res, 'capture', 'in_progress', 'Capturing website screenshot...');
    
    let screenshotBase64: string;
    try {
      const screenshotOneApiKey = process.env.SCREENSHOTONE_API_KEY;
      
      if (!screenshotOneApiKey) {
        sendStageUpdate(res, 'capture', 'error', 'Screenshot service not configured');
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Screenshot service not configured' })}\n\n`);
        return res.end();
      }
      
      const screenshotParams = new URLSearchParams({
        access_key: screenshotOneApiKey,
        url: url,
        viewport_width: '1920',
        viewport_height: '1080',
        format: 'png',
        full_page: 'false',
        delay: '2',
        block_ads: 'true',
        block_cookie_banners: 'true',
      });
      
      const screenshotUrl = `https://api.screenshotone.com/take?${screenshotParams.toString()}`;
      const response = await fetch(screenshotUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Screenshot API error: ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      screenshotBase64 = Buffer.from(buffer).toString('base64');
      
      console.log(`[PortalCustomizer] Screenshot captured, size: ${Math.round(screenshotBase64.length / 1024)}KB`);
      sendStageUpdate(res, 'capture', 'complete', 'Website screenshot captured');
    } catch (fetchError: any) {
      console.error('[PortalCustomizer] Failed to capture screenshot:', fetchError);
      sendStageUpdate(res, 'capture', 'error', 'Failed to capture screenshot');
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to capture website screenshot', details: fetchError.message })}\n\n`);
      return res.end();
    }

    // ========== STAGE 2: Analyze Design & Generate 3 Options ==========
    sendStageUpdate(res, 'analyze', 'in_progress', 'AI analyzing website design...');
    
    const analysisPrompt = `You are an expert web designer analyzing a website screenshot to create chat portal themes.

Analyze this screenshot of ${url} and create THREE distinct theme options for a chat portal that would feel native to this website.

For each theme option:
1. Extract and adapt the brand colors appropriately
2. Consider different design approaches (e.g., matching exactly, lighter variation, dark mode adaptation)
3. Ensure good contrast and accessibility

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "themes": [
    {
      "id": "exact-match",
      "name": "Brand Match",
      "description": "Exact match to website's primary brand colors",
      "primaryColor": "#hex",
      "accentColor": "#hex",
      "backgroundColor": "#hex",
      "textColor": "#hex",
      "fontFamily": "font name",
      "borderRadius": "0px|4px|8px|16px"
    },
    {
      "id": "light-variant",
      "name": "Light & Clean",
      "description": "Lighter, more airy variant of the brand",
      "primaryColor": "#hex",
      "accentColor": "#hex",
      "backgroundColor": "#hex",
      "textColor": "#hex",
      "fontFamily": "font name",
      "borderRadius": "0px|4px|8px|16px"
    },
    {
      "id": "modern-dark",
      "name": "Modern Dark",
      "description": "Dark mode adaptation with brand accent colors",
      "primaryColor": "#hex",
      "accentColor": "#hex",
      "backgroundColor": "#hex",
      "textColor": "#hex",
      "fontFamily": "font name",
      "borderRadius": "0px|4px|8px|16px"
    }
  ],
  "brandAnalysis": "Brief analysis of the website's visual identity"
}`;

    let themeOptions: ThemeOption[];
    let brandAnalysis: string;
    
    try {
      const analysisMessage = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 },
              },
              { type: 'text', text: analysisPrompt },
            ],
          },
        ],
      });

      const responseText = analysisMessage.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as any).text)
        .join('\n');

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      
      const parsed = JSON.parse(jsonMatch[0]);
      themeOptions = parsed.themes;
      brandAnalysis = parsed.brandAnalysis;
      
      console.log(`[PortalCustomizer] Generated ${themeOptions.length} theme options`);
      sendStageUpdate(res, 'analyze', 'complete', `Generated ${themeOptions.length} theme options`);
    } catch (parseError: any) {
      console.error('[PortalCustomizer] Failed to generate themes:', parseError);
      sendStageUpdate(res, 'analyze', 'error', 'Failed to analyze design');
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to analyze website design' })}\n\n`);
      return res.end();
    }

    // ========== STAGE 3: Generate Preview Images ==========
    sendStageUpdate(res, 'preview', 'in_progress', 'Creating theme previews...');
    
    const screenshotOneApiKey = process.env.SCREENSHOTONE_API_KEY!;
    
    for (let i = 0; i < themeOptions.length; i++) {
      const theme = themeOptions[i];
      sendStageUpdate(res, 'preview', 'in_progress', `Creating preview ${i + 1} of ${themeOptions.length}: ${theme.name}...`);
      
      try {
        const previewHtml = generatePreviewHtml(theme);
        
        // Use ScreenshotOne's HTML rendering
        const previewParams = new URLSearchParams({
          access_key: screenshotOneApiKey,
          html: previewHtml,
          viewport_width: '400',
          viewport_height: '500',
          format: 'png',
        });
        
        const previewUrl = `https://api.screenshotone.com/take?${previewParams.toString()}`;
        const previewResponse = await fetch(previewUrl);
        
        if (previewResponse.ok) {
          const previewBuffer = await previewResponse.arrayBuffer();
          theme.previewImage = Buffer.from(previewBuffer).toString('base64');
          console.log(`[PortalCustomizer] Preview generated for ${theme.name}`);
        } else {
          console.warn(`[PortalCustomizer] Failed to generate preview for ${theme.name}`);
        }
      } catch (previewError) {
        console.warn(`[PortalCustomizer] Preview error for ${theme.name}:`, previewError);
      }
    }
    
    sendStageUpdate(res, 'preview', 'complete', 'Theme previews created');

    // ========== STAGE 4: AI Self-Review & Refinement ==========
    sendStageUpdate(res, 'review', 'in_progress', 'AI reviewing and refining theme options...');
    
    try {
      // Build review prompt with all preview images + original website
      const reviewContent: any[] = [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 },
        },
        {
          type: 'text',
          text: `Original website (${url}) for reference:`,
        },
      ];
      
      for (const theme of themeOptions) {
        if (theme.previewImage) {
          reviewContent.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: theme.previewImage },
          });
          reviewContent.push({
            type: 'text',
            text: `Theme "${theme.id}": "${theme.name}" - ${theme.description}
Current colors: primary=${theme.primaryColor}, accent=${theme.accentColor}, bg=${theme.backgroundColor}, text=${theme.textColor}`,
          });
        }
      }
      
      reviewContent.push({
        type: 'text',
        text: `You are reviewing these 3 chat portal theme previews against the original website.

For each theme:
1. Score it 1-10 (brand alignment, visual appeal, usability)
2. If the score is below 8, IMPROVE IT by providing corrected colors
3. Identify any issues (poor contrast, wrong colors, bad readability) and fix them

Return ONLY valid JSON:
{
  "reviews": [
    {
      "id": "exact-match",
      "score": 8,
      "notes": "Brief review notes explaining issues or strengths",
      "needsImprovement": false
    },
    {
      "id": "light-variant",
      "score": 6,
      "notes": "Background too dark for light theme, text contrast poor",
      "needsImprovement": true,
      "improvedColors": {
        "primaryColor": "#hex",
        "accentColor": "#hex",
        "backgroundColor": "#hex",
        "textColor": "#hex"
      }
    },
    {
      "id": "modern-dark",
      "score": 7,
      "notes": "Good dark theme but accent color clashes",
      "needsImprovement": true,
      "improvedColors": {
        "accentColor": "#hex"
      }
    }
  ],
  "topPick": "theme-id",
  "summary": "Overall assessment of the three themes"
}

Only include "improvedColors" if the theme needs fixing. Only include colors that need to change.`,
      });

      const reviewMessage = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{ role: 'user', content: reviewContent }],
      });

      const reviewText = reviewMessage.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as any).text)
        .join('\n');

      const reviewMatch = reviewText.match(/\{[\s\S]*\}/);
      if (reviewMatch) {
        const reviewData = JSON.parse(reviewMatch[0]);
        
        // Track which themes were improved
        const improvedThemes: string[] = [];
        
        // Merge review scores and improvements back into theme options
        for (const review of reviewData.reviews) {
          const theme = themeOptions.find(t => t.id === review.id);
          if (theme) {
            theme.aiScore = review.score;
            theme.aiNotes = review.notes;
            
            // Apply improvements if provided
            if (review.needsImprovement && review.improvedColors) {
              if (review.improvedColors.primaryColor) theme.primaryColor = review.improvedColors.primaryColor;
              if (review.improvedColors.accentColor) theme.accentColor = review.improvedColors.accentColor;
              if (review.improvedColors.backgroundColor) theme.backgroundColor = review.improvedColors.backgroundColor;
              if (review.improvedColors.textColor) theme.textColor = review.improvedColors.textColor;
              if (review.improvedColors.fontFamily) theme.fontFamily = review.improvedColors.fontFamily;
              if (review.improvedColors.borderRadius) theme.borderRadius = review.improvedColors.borderRadius;
              
              improvedThemes.push(theme.name);
              theme.aiNotes = `✨ Improved: ${review.notes}`;
              // Boost score after improvement
              theme.aiScore = Math.min(10, (review.score || 7) + 2);
            }
          }
        }
        
        // Sort by score (highest first)
        themeOptions.sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));
        
        if (improvedThemes.length > 0) {
          console.log(`[PortalCustomizer] AI improved ${improvedThemes.length} themes: ${improvedThemes.join(', ')}`);
          sendStageUpdate(res, 'review', 'in_progress', `Improved ${improvedThemes.length} theme(s), regenerating previews...`);
          
          // Regenerate previews for improved themes
          for (const theme of themeOptions) {
            if (improvedThemes.includes(theme.name)) {
              try {
                const previewHtml = generatePreviewHtml(theme);
                const previewParams = new URLSearchParams({
                  access_key: screenshotOneApiKey,
                  html: previewHtml,
                  viewport_width: '400',
                  viewport_height: '500',
                  format: 'png',
                });
                
                const previewUrl = `https://api.screenshotone.com/take?${previewParams.toString()}`;
                const previewResponse = await fetch(previewUrl);
                
                if (previewResponse.ok) {
                  const previewBuffer = await previewResponse.arrayBuffer();
                  theme.previewImage = Buffer.from(previewBuffer).toString('base64');
                  console.log(`[PortalCustomizer] Regenerated preview for improved ${theme.name}`);
                }
              } catch (previewError) {
                console.warn(`[PortalCustomizer] Failed to regenerate preview for ${theme.name}`);
              }
            }
          }
        }
        
        console.log(`[PortalCustomizer] AI review complete. Top pick: ${reviewData.topPick}`);
      }
      
      sendStageUpdate(res, 'review', 'complete', 'AI review and refinement complete');
    } catch (reviewError) {
      console.warn('[PortalCustomizer] AI review failed, continuing without refinement:', reviewError);
      sendStageUpdate(res, 'review', 'complete', 'Skipped AI review');
    }

    // ========== STAGE 5: Complete ==========
    sendStageUpdate(res, 'complete', 'complete', 'Analysis complete!');
    
    // Generate full CSS for each theme
    const themesWithCSS = themeOptions.map(theme => ({
      ...theme,
      customCSS: generatePortalCSS({
        primaryColor: theme.primaryColor,
        accentColor: theme.accentColor,
        backgroundColor: theme.backgroundColor,
        textColor: theme.textColor,
        fontFamily: theme.fontFamily,
        borderRadius: theme.borderRadius,
        customCSS: '',
        reasoning: theme.description,
      }),
    }));

    // Send final result
    res.write(`data: ${JSON.stringify({
      type: 'result',
      themes: themesWithCSS,
      brandAnalysis,
      websiteScreenshot: screenshotBase64,
      previewUrl: `/portal/${sessionId}`,
    })}\n\n`);
    
    res.end();
    
  } catch (error: any) {
    console.error('[PortalCustomizer] Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to analyze website', details: error.message })}\n\n`);
    res.end();
  }
});

/**
 * Generate HTML for a theme preview that EXACTLY matches the real Portal component
 * This ensures AI reviews accurately represent what users will see
 */
function generatePreviewHtml(theme: ThemeOption): string {
  // Calculate accent color (slightly lighter/different from background for sidebar/topbar)
  const accentColor = theme.accentColor || adjustColorBrightness(theme.backgroundColor, 15);
  
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${theme.fontFamily}, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      background: #1a1a1a;
      padding: 10px;
    }
    
    /* Main portal container - matches Portal.tsx structure */
    .portal-container {
      width: 380px;
      height: 480px;
      display: flex;
      background-color: ${theme.backgroundColor};
      color: ${theme.textColor};
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    
    /* Sidebar - matches .portal-sidebar */
    .portal-sidebar {
      width: 180px;
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(255,255,255,0.1);
      background-color: ${accentColor};
    }
    
    /* Sidebar header */
    .portal-header {
      padding: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .portal-title {
      font-size: 14px;
      font-weight: 600;
      color: ${theme.textColor};
    }
    
    /* New conversation button */
    .new-thread-button {
      margin: 8px;
      padding: 8px 12px;
      background-color: ${theme.primaryColor};
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    /* Thread list */
    .thread-list {
      flex: 1;
      padding: 4px 8px;
      overflow: hidden;
    }
    .thread-item {
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 12px;
      color: ${theme.textColor};
      opacity: 0.8;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .thread-item.active {
      background: rgba(255,255,255,0.1);
      opacity: 1;
    }
    
    /* Main chat area */
    .portal-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    
    /* Top bar */
    .portal-topbar {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      background-color: ${accentColor};
      font-size: 12px;
      color: ${theme.textColor};
      opacity: 0.7;
    }
    
    /* Messages container */
    .chat-container {
      flex: 1;
      padding: 12px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    /* Message bubbles - match Portal.tsx exactly */
    .message-bubble {
      display: flex;
    }
    .message-bubble.user {
      justify-content: flex-end;
    }
    .message-bubble.assistant {
      justify-content: flex-start;
    }
    
    .message-content {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 13px;
      line-height: 1.4;
    }
    
    /* User messages - uses primaryColor */
    .message-bubble.user .message-content {
      background-color: ${theme.primaryColor};
      color: #ffffff;
    }
    
    /* Assistant messages - uses bg with border */
    .message-bubble.assistant .message-content {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      color: ${theme.textColor};
    }
    
    /* Input area */
    .input-container {
      padding: 12px;
      border-top: 1px solid rgba(255,255,255,0.1);
      background-color: ${accentColor};
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    
    .input-field {
      flex: 1;
      padding: 10px 14px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      color: ${theme.textColor};
      font-size: 13px;
    }
    .input-field::placeholder {
      color: rgba(255,255,255,0.4);
    }
    
    .send-button {
      padding: 10px 16px;
      background-color: ${theme.primaryColor};
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }
    
    /* Theme label */
    .theme-label {
      text-align: center;
      padding: 6px;
      font-size: 11px;
      color: #888;
      background: #1a1a1a;
    }
  </style>
</head>
<body>
  <div class="portal-container">
    <!-- Sidebar -->
    <div class="portal-sidebar">
      <div class="portal-header">
        <div class="portal-title">AI Assistant</div>
      </div>
      <button class="new-thread-button">+ New conversation</button>
      <div class="thread-list">
        <div class="thread-item active">Current conversation</div>
        <div class="thread-item">Previous chat...</div>
      </div>
    </div>
    
    <!-- Main Area -->
    <div class="portal-main">
      <div class="portal-topbar">Current conversation</div>
      
      <div class="chat-container">
        <div class="message-bubble user">
          <div class="message-content">Hello! Can you help me with something?</div>
        </div>
        <div class="message-bubble assistant">
          <div class="message-content">Of course! I'd be happy to help. What can I assist you with today?</div>
        </div>
        <div class="message-bubble user">
          <div class="message-content">I need some information</div>
        </div>
        <div class="message-bubble assistant">
          <div class="message-content">I'm here to help! Please tell me more about what you're looking for.</div>
        </div>
      </div>
      
      <div class="input-container">
        <input type="text" class="input-field" placeholder="Type a message..." />
        <button class="send-button">Send</button>
      </div>
    </div>
  </div>
  <div class="theme-label">${theme.name}</div>
</body>
</html>`;
}

/**
 * POST /api/portal-customizer/refine
 * Refine themes based on user feedback
 */
router.post('/refine', requireAuth, async (req: Request, res: Response) => {
  const { sessionId, themes, feedback, websiteUrl } = req.body;
  const userId = req.session.userId!;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    if (!themes || !Array.isArray(themes) || themes.length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Themes are required' })}\n\n`);
      return res.end();
    }

    if (!feedback || feedback.trim().length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Feedback is required' })}\n\n`);
      return res.end();
    }

    // Verify session belongs to user
    const session = await queryOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (!session) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Agent not found' })}\n\n`);
      return res.end();
    }

    console.log(`[PortalCustomizer] Refining themes based on feedback: "${feedback.slice(0, 100)}..."`);

    // ========== STAGE 1: Processing Feedback ==========
    sendStageUpdate(res, 'feedback', 'in_progress', 'AI processing your feedback...');

    // Build refinement prompt with current themes
    const themeSummaries = themes.map((t: ThemeOption) => 
      `Theme "${t.name}" (${t.id}):
  - Primary: ${t.primaryColor}
  - Accent: ${t.accentColor}
  - Background: ${t.backgroundColor}
  - Text: ${t.textColor}
  - Font: ${t.fontFamily}
  - Border Radius: ${t.borderRadius}
  - AI Notes: ${t.aiNotes || 'None'}`
    ).join('\n\n');

    const refinementPrompt = `You are an expert web designer helping a user customize their chat portal theme.

The user was shown these 3 theme options for their portal${websiteUrl ? ` (designed to match ${websiteUrl})` : ''}:

${themeSummaries}

The user has provided this feedback:
"${feedback}"

Based on their feedback, create 3 IMPROVED theme variations. You can:
1. Modify existing themes to address the feedback
2. Create entirely new themes if the feedback indicates they want something different
3. Keep themes that the user liked (if mentioned) and improve the others

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "themes": [
    {
      "id": "refined-1",
      "name": "Theme Name",
      "description": "How this addresses the user's feedback",
      "primaryColor": "#hex",
      "accentColor": "#hex",
      "backgroundColor": "#hex",
      "textColor": "#hex",
      "fontFamily": "font name",
      "borderRadius": "0px|4px|8px|16px"
    },
    {
      "id": "refined-2",
      ...
    },
    {
      "id": "refined-3",
      ...
    }
  ],
  "refinementNotes": "Brief explanation of how you addressed the feedback"
}`;

    let refinedThemes: ThemeOption[];
    let refinementNotes: string;

    try {
      const refinementMessage = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: refinementPrompt }],
      });

      const responseText = refinementMessage.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as any).text)
        .join('\n');

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]);
      refinedThemes = parsed.themes;
      refinementNotes = parsed.refinementNotes;

      console.log(`[PortalCustomizer] Generated ${refinedThemes.length} refined themes`);
      sendStageUpdate(res, 'feedback', 'complete', 'Feedback processed');
    } catch (parseError: any) {
      console.error('[PortalCustomizer] Failed to refine themes:', parseError);
      sendStageUpdate(res, 'feedback', 'error', 'Failed to process feedback');
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to refine themes' })}\n\n`);
      return res.end();
    }

    // ========== STAGE 2: Generate New Previews ==========
    sendStageUpdate(res, 'preview', 'in_progress', 'Creating refined previews...');

    const screenshotOneApiKey = process.env.SCREENSHOTONE_API_KEY!;

    for (let i = 0; i < refinedThemes.length; i++) {
      const theme = refinedThemes[i];
      sendStageUpdate(res, 'preview', 'in_progress', `Creating preview ${i + 1} of ${refinedThemes.length}: ${theme.name}...`);

      try {
        const previewHtml = generatePreviewHtml(theme);

        const previewParams = new URLSearchParams({
          access_key: screenshotOneApiKey,
          html: previewHtml,
          viewport_width: '400',
          viewport_height: '500',
          format: 'png',
        });

        const previewUrl = `https://api.screenshotone.com/take?${previewParams.toString()}`;
        const previewResponse = await fetch(previewUrl);

        if (previewResponse.ok) {
          const previewBuffer = await previewResponse.arrayBuffer();
          theme.previewImage = Buffer.from(previewBuffer).toString('base64');
          console.log(`[PortalCustomizer] Preview generated for refined ${theme.name}`);
        }
      } catch (previewError) {
        console.warn(`[PortalCustomizer] Preview error for ${theme.name}:`, previewError);
      }
    }

    sendStageUpdate(res, 'preview', 'complete', 'Previews created');

    // ========== STAGE 3: Complete ==========
    sendStageUpdate(res, 'complete', 'complete', 'Refinement complete!');

    // Generate full CSS for each theme
    const themesWithCSS = refinedThemes.map(theme => ({
      ...theme,
      customCSS: generatePortalCSS({
        primaryColor: theme.primaryColor,
        accentColor: theme.accentColor,
        backgroundColor: theme.backgroundColor,
        textColor: theme.textColor,
        fontFamily: theme.fontFamily,
        borderRadius: theme.borderRadius,
        customCSS: '',
        reasoning: theme.description,
      }),
      aiScore: 8, // Refined themes get a baseline good score
      aiNotes: `Refined based on your feedback`,
    }));

    // Send final result
    res.write(`data: ${JSON.stringify({
      type: 'result',
      themes: themesWithCSS,
      refinementNotes,
      previewUrl: `/portal/${sessionId}`,
    })}\n\n`);

    res.end();

  } catch (error: any) {
    console.error('[PortalCustomizer] Refinement error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to refine themes', details: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/portal-customizer/apply
 * Apply a selected theme to an agent's portal
 */
router.post('/apply', requireAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId, theme, customCSS } = req.body;
    const userId = req.session.userId!;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    if (!theme) {
      return res.status(400).json({ error: 'Theme is required' });
    }

    // Verify session belongs to user
    const session = await queryOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Build embed_theme object with theme colors
    const embedTheme = {
      primaryColor: theme.primaryColor,
      backgroundColor: theme.backgroundColor,
      accentColor: theme.accentColor,
      textColor: theme.textColor,
      buttonColor: theme.primaryColor,
      fontFamily: theme.fontFamily === 'system' ? 'system' : 'custom',
    };

    // Generate CSS if not provided
    const finalCSS = customCSS || generatePortalCSS({
      ...theme,
      customCSS: '',
      reasoning: theme.description || '',
    });

    // Update or create agent config with both theme and custom CSS
    const existingConfig = await queryOne<{ id: string }>(
      'SELECT id FROM agent_configs WHERE session_id = $1',
      [sessionId]
    );

    if (existingConfig) {
      await execute(
        `UPDATE agent_configs SET portal_custom_css = $1, embed_theme = $2, updated_at = NOW() WHERE session_id = $3`,
        [finalCSS, JSON.stringify(embedTheme), sessionId]
      );
    } else {
      const configId = crypto.randomUUID();
      await execute(
        'INSERT INTO agent_configs (id, session_id, portal_custom_css, embed_theme) VALUES ($1, $2, $3, $4)',
        [configId, sessionId, finalCSS, JSON.stringify(embedTheme)]
      );
    }

    console.log(`[PortalCustomizer] Applied theme "${theme.name}" to session ${sessionId}`);

    res.json({ 
      success: true,
      message: `Theme "${theme.name}" applied successfully`,
      previewUrl: `/portal/${sessionId}`,
      appliedTheme: theme.name,
    });
  } catch (error: any) {
    console.error('[PortalCustomizer] Error applying styles:', error);
    res.status(500).json({ 
      error: 'Failed to apply portal styling',
      details: error.message 
    });
  }
});

interface StyleAnalysis {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  borderRadius: string;
  customCSS: string;
  reasoning: string;
}

/**
 * Generate comprehensive portal CSS that matches Portal.tsx structure
 * Uses !important where needed to override inline styles
 */
function generatePortalCSS(analysis: StyleAnalysis): string {
  const { primaryColor, accentColor, backgroundColor, textColor, fontFamily, borderRadius } = analysis;

  return `/* Auto-generated portal styling to match your website */
/* Generated for Portal.tsx component structure */

/* ===== MAIN CONTAINER ===== */
.portal-container {
  font-family: ${fontFamily}, system-ui, -apple-system, BlinkMacSystemFont, sans-serif !important;
  background-color: ${backgroundColor} !important;
  color: ${textColor} !important;
}

/* ===== SIDEBAR ===== */
.portal-sidebar {
  background-color: ${accentColor} !important;
  color: ${textColor} !important;
}

.portal-header {
  border-color: rgba(255,255,255,0.1) !important;
}

.portal-title {
  color: ${textColor} !important;
}

/* New conversation button */
.new-thread-button {
  background-color: ${primaryColor} !important;
  color: white !important;
  border-radius: ${borderRadius} !important;
}

.new-thread-button:hover {
  background-color: ${adjustColorBrightness(primaryColor, -10)} !important;
}

/* Thread items */
.thread-item {
  color: ${textColor} !important;
  border-radius: ${borderRadius} !important;
}

.thread-item:hover {
  background-color: rgba(255,255,255,0.05) !important;
}

.thread-active, .thread-item.active {
  background-color: rgba(255,255,255,0.1) !important;
}

/* ===== TOP BAR ===== */
.portal-topbar {
  background-color: ${accentColor} !important;
  color: ${textColor} !important;
}

.portal-toggle {
  color: ${textColor} !important;
}

/* ===== CHAT AREA ===== */
.chat-container {
  color: ${textColor} !important;
}

/* ===== MESSAGES ===== */
/* User messages - bubble with primary color */
.message-bubble.message-user .message-content,
.message-user .message-content {
  background-color: ${primaryColor} !important;
  color: #ffffff !important;
  border-radius: ${borderRadius === '0px' ? '16px' : borderRadius} !important;
}

/* Assistant messages - subtle background */
.message-bubble.message-assistant .message-content,
.message-assistant .message-content {
  background-color: rgba(255,255,255,0.05) !important;
  border: 1px solid rgba(255,255,255,0.1) !important;
  color: ${textColor} !important;
  border-radius: ${borderRadius === '0px' ? '16px' : borderRadius} !important;
}

/* Code blocks in messages */
.message-content code {
  background-color: rgba(0,0,0,0.3) !important;
  color: inherit !important;
}

.message-content pre {
  background-color: rgba(0,0,0,0.4) !important;
  border-radius: 8px !important;
}

/* ===== INPUT AREA ===== */
.input-container {
  background-color: ${accentColor} !important;
  border-color: rgba(255,255,255,0.1) !important;
}

.input-field {
  background-color: rgba(255,255,255,0.05) !important;
  border: 1px solid rgba(255,255,255,0.1) !important;
  color: ${textColor} !important;
  border-radius: ${borderRadius === '0px' ? '12px' : borderRadius} !important;
}

.input-field:focus {
  border-color: ${primaryColor} !important;
  box-shadow: 0 0 0 2px ${primaryColor}30 !important;
}

.input-field::placeholder {
  color: rgba(255,255,255,0.4) !important;
}

/* Send button */
.send-button {
  background-color: ${primaryColor} !important;
  color: white !important;
  border-radius: ${borderRadius === '0px' ? '12px' : borderRadius} !important;
}

.send-button:hover {
  background-color: ${adjustColorBrightness(primaryColor, -10)} !important;
}

/* ===== SCROLLBARS ===== */
.chat-container::-webkit-scrollbar {
  width: 6px;
}

.chat-container::-webkit-scrollbar-track {
  background: transparent;
}

.chat-container::-webkit-scrollbar-thumb {
  background: ${accentColor};
  border-radius: 3px;
}

.chat-container::-webkit-scrollbar-thumb:hover {
  background: ${primaryColor};
}

/* ===== STATUS BANNERS ===== */
/* Warming up banner */
.portal-container [class*="bg-purple"] {
  background-color: ${primaryColor}15 !important;
  border-color: ${primaryColor}40 !important;
}

/* ===== THINKING PANEL ===== */
.prose {
  color: ${textColor} !important;
}

/* ===== FILES PANEL ===== */
.portal-container [class*="border-l"] {
  background-color: ${accentColor} !important;
}

/* ===== LINKS ===== */
.portal-container a {
  color: ${primaryColor} !important;
}

.portal-container a:hover {
  color: ${adjustColorBrightness(primaryColor, 15)} !important;
}

${analysis.customCSS || ''}
`;
}

/**
 * Adjust color brightness (simple hex manipulation)
 */
function adjustColorBrightness(hex: string, percent: number): string {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Convert to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Adjust brightness
  const adjust = (val: number) => {
    const adjusted = val + (val * percent) / 100;
    return Math.max(0, Math.min(255, Math.round(adjusted)));
  };
  
  // Convert back to hex
  const toHex = (val: number) => val.toString(16).padStart(2, '0');
  
  return `#${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`;
}

export default router;
