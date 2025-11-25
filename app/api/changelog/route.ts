import { NextResponse } from "next/server"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

interface GitCommit {
  hash: string
  date: string
  author: string
  authorEmail: string
  message: string
  body: string
  files: string[]
  additions: number
  deletions: number
  filesChanged: number
}

interface ChangelogEntry {
  date: string
  commits: GitCommit[]
}

export async function GET() {
  try {
    // Check if git is available and this is a git repository
    try {
      await execAsync("git rev-parse --git-dir")
    } catch {
      return NextResponse.json({
        changelog: [],
        message: "Not a git repository",
      })
    }

    // Get git log with format: hash|date|author|authorEmail|subject|body
    const { stdout } = await execAsync(
      'git log --pretty=format:"%H|%aI|%an|%ae|%s|%b" --date=iso --no-merges -50'
    )

    if (!stdout.trim()) {
      return NextResponse.json({
        changelog: [],
        message: "No commits found",
      })
    }

    const lines = stdout.trim().split("\n")
    const commits: GitCommit[] = []

    // Parse each commit
    for (const line of lines) {
      const parts = line.split("|")
      if (parts.length < 5) continue
      
      const [hash, date, author, authorEmail, subject, ...bodyParts] = parts
      const message = subject
      const body = bodyParts.join("|").trim()

      // Get files changed in this commit with stats
      let files: string[] = []
      let additions = 0
      let deletions = 0
      let filesChanged = 0
      
      try {
        // Get file names
        const { stdout: filesOut } = await execAsync(`git show --name-only --pretty=format: ${hash}`)
        files = filesOut
          .trim()
          .split("\n")
          .filter((f) => f.length > 0)
        
        filesChanged = files.length
        
        // Get stats (additions/deletions)
        const { stdout: statsOut } = await execAsync(`git show --shortstat --pretty=format: ${hash}`)
        const statsMatch = statsOut.match(/(\d+) insertions?\(\+\)|(\d+) deletions?\(-\)/)
        if (statsMatch) {
          additions = parseInt(statsMatch[1] || "0")
          deletions = parseInt(statsMatch[2] || "0")
        }
      } catch {
        // If we can't get files, just continue
      }

      commits.push({
        hash,
        date,
        author,
        authorEmail,
        message,
        body,
        files,
        additions,
        deletions,
        filesChanged,
      })
    }

    // Group commits by date
    const groupedByDate: { [key: string]: GitCommit[] } = {}
    
    commits.forEach((commit) => {
      const date = new Date(commit.date).toISOString().split("T")[0]
      if (!groupedByDate[date]) {
        groupedByDate[date] = []
      }
      groupedByDate[date].push(commit)
    })

    // Convert to array and sort by date (newest first)
    const changelog: ChangelogEntry[] = Object.entries(groupedByDate)
      .map(([date, commits]) => ({
        date,
        commits,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return NextResponse.json({
      changelog,
      totalCommits: commits.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Changelog error:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch changelog",
        message: error instanceof Error ? error.message : "Unknown error",
        changelog: [],
      },
      { status: 500 }
    )
  }
}
