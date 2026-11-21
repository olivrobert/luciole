<?php

declare(strict_types=1);

namespace Reader\Infrastructure\Symfony\Repository;

use Catalog\Domain\Model\Book;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Reader\Domain\Model\Review;
use Reader\Domain\Repository\ReviewRepositoryInterface;

/**
 * @extends ServiceEntityRepository<Review>
 */
class ReviewRepository extends ServiceEntityRepository implements ReviewRepositoryInterface
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Review::class);
    }

    public function save(Review $review): void
    {
        $this->getEntityManager()->persist($review);
    }

    public function findById(int $id): ?Review
    {
        return $this->find($id);
    }

    /**
     * @param array{rating?: int, book?: Book} $criteria
     *
     * @return list<Review>
     */
    public function findByCriteria(array $criteria): array
    {
        return $this->findBy($criteria, ['createdAt' => 'DESC']);
    }

    /**
     * @return list<Review>
     */
    public function findModerationHistory(Book $book): array
    {
        $filters = $this->getEntityManager()->getFilters();
        $filters->disable('softdeleteable');

        /** @var list<Review> $reviews */
        $reviews = $this->createQueryBuilder('r')
            ->where('r.book = :book')
            ->setParameter('book', $book)
            ->orderBy('r.createdAt', 'DESC')
            ->getQuery()
            ->getResult();

        $filters->enable('softdeleteable');

        return $reviews;
    }
}
