const FLAGS = {
  scoring: {
    cluster: {
      eligible: 20, // cluster_score >= eligible → send to LLM
      optional: 12, // cluster_score >= optional → conditional send
      // < optional → discard
    },
    story: {
      publish: 60, // story_score >= publish → publish candidate
      review:  35, // story_score >= review  → flag for manual review
      // < review → reject
    },
  },
};

export default FLAGS;
