import { Link } from 'react-router-dom';
import { useAuth } from '@/stores/auth';

const examples = [
  {
    title: 'Data Analyst',
    description: 'Query databases, generate reports, visualize insights automatically',
  },
  {
    title: 'Code Reviewer',
    description: 'Review PRs, suggest improvements, enforce coding standards',
  },
  {
    title: 'Research Agent',
    description: 'Deep research on candidates, companies, or any topic',
  },
  {
    title: 'AI SDR',
    description: 'Qualify leads, personalize outreach, book meetings',
  },
  {
    title: 'AI SRE',
    description: 'Monitor systems, diagnose issues, automate incident response',
  },
];


export function Home() {
  const { isAuthenticated } = useAuth();

  // Authenticated users see themed content
  if (isAuthenticated) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-24">
        <div className="space-y-12">
          {/* Hero Section */}
          <div className="space-y-8">
            <h1 className="text-5xl md:text-6xl font-semibold leading-tight tracking-tight">
              <span className="text-slate-900 dark:text-white">Ship agents,</span>
              <br />
              <span className="text-slate-400 dark:text-slate-500">
                not infrastructure
              </span>
            </h1>

            <p className="text-slate-600 dark:text-slate-400 text-lg max-w-xl leading-relaxed">
              Heroku for AI agents. Agent loop as a service.
            </p>

            {/* CTAs */}
            <div className="flex gap-4 pt-4">
              <Link
                to="/agents"
                className="bg-slate-800 hover:bg-slate-900 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors"
              >
                Go to Agents →
              </Link>
            </div>
          </div>

          {/* What you can build */}
          <div className="pt-12 border-t border-slate-200 dark:border-slate-700">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-8">
              What you can build
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {examples.map((example) => (
                <div
                  key={example.title}
                  className="p-5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-blue-500/50 hover:shadow-sm transition-all"
                >
                  <h3 className="text-slate-900 dark:text-white font-medium mb-2">{example.title}</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm">{example.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Non-authenticated users see dark landing page (matches Layout header)
  return (
    <div className="max-w-5xl mx-auto px-6 py-24">
      <div className="space-y-12">
        {/* Hero Section */}
        <div className="space-y-8">
          <h1 className="text-5xl md:text-6xl font-medium leading-tight tracking-tight">
            <span className="text-white">Ship agents,</span>
            <br />
            <span className="text-gray-400 underline decoration-gray-600 underline-offset-8">
              not infrastructure
            </span>
          </h1>

          <p className="text-gray-400 text-lg max-w-xl leading-relaxed">
            Heroku for AI agents. Agent loop as a service.
          </p>

          {/* CTAs */}
          <div className="flex gap-4 pt-4">
            <Link
              to="/register"
              className="bg-white text-black px-6 py-3 rounded text-sm font-medium hover:bg-gray-200"
            >
              Get Started →
            </Link>
          </div>
        </div>

        {/* What you can build */}
        <div className="pt-12 border-t border-white/10">
          <h2 className="text-2xl font-medium text-white mb-8">
            What you can build
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {examples.map((example) => (
              <div
                key={example.title}
                className="p-5 bg-white/5 border border-white/10 rounded-lg hover:border-white/20 transition-colors"
              >
                <h3 className="text-white font-medium mb-2">{example.title}</h3>
                <p className="text-gray-400 text-sm">{example.description}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
